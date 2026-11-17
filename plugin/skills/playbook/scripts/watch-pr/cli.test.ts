import { describe, expect, it } from "bun:test";
import { type CliRuntime, main, parseArgs } from "./cli.ts";
import {
  type FakeReaderOptions,
  fakeReader,
  passingCheck,
  pendingCheck,
} from "./fakes.test-helper.ts";
import { WatcherQueryError } from "./github.ts";
import { renderJson, renderPretty } from "./render.ts";
import type {
  ChecksFastPath,
  GitHubReader,
  OpenPullRequest,
  PrContext,
  PullRequestFacts,
  WatcherVerdict,
} from "./types.ts";
import { parsePrNumber } from "./types.ts";

const silentIo = { stdout: () => {}, stderr: () => {} };

function testRuntime(reader: GitHubReader): {
  readonly runtime: CliRuntime;
  readonly stdout: string[];
  readonly stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    runtime: {
      reader,
      clock: {
        now: () => 0,
        observedAt: () => "2026-07-26T00:00:00.000Z",
        async sleep() {
          throw new Error("test unexpectedly slept");
        },
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

describe("parseArgs", () => {
  it("uses the specified defaults", () => {
    expect(parseArgs([], silentIo)).toMatchObject({
      owner: null,
      repo: null,
      pr: null,
      mode: "single",
      stackPrs: [],
      statusOnly: false,
      pretty: false,
      polling: {
        interval: 60,
        sweepInterval: 300,
        timeout: 0,
        maxQueryErrors: 5,
        allowDraft: false,
        once: false,
      },
    });
  });

  it("parses a frozen queued stack bottom-to-top", () => {
    const parsed = parseArgs(
      [
        "--queued-stack",
        "--stack-prs",
        "#10, 11,#12",
        "--interval",
        "2.5",
        "--sweep-interval",
        "30",
        "--timeout",
        "0",
        "--max-query-errors",
        "3",
        "--allow-draft",
        "--pretty",
      ],
      silentIo
    );
    expect(parsed.mode).toBe("queued-stack");
    expect(parsed.stackPrs.map(Number)).toEqual([10, 11, 12]);
    expect(parsed.polling).toEqual({
      interval: 2.5,
      sweepInterval: 30,
      timeout: 0,
      maxQueryErrors: 3,
      allowDraft: true,
      once: false,
    });
    expect(parsed.pretty).toBe(true);
  });

  it("rejects every invalid mode and numeric shape as usage", async () => {
    const invalid = [
      ["--unknown"],
      ["--interval", "0"],
      ["--sweep-interval", "-1"],
      ["--timeout", "-1"],
      ["--max-query-errors", "1.5"],
      ["--stack", "--queued-stack"],
      ["--stack-prs", "1,2"],
      ["--queued-stack", "--stack-prs", "1,1"],
      ["--once", "--status-only"],
    ];
    for (const argv of invalid) {
      const harness = testRuntime(fakeReader());
      expect(await main(argv, harness.runtime)).toBe(64);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr.join("")).toContain("error:");
    }
  });
});

describe("rendering", () => {
  const context = {
    owner: "owner",
    repo: "repo",
    number: parsePrNumber(1),
  };
  const status = {
    schemaVersion: 1,
    sequence: 1,
    observedAt: "2026-07-26T00:00:00.000Z",
    mode: "single",
    kind: "STATUS",
    terminal: true,
    exitCode: 0,
    reason: "status-only",
    rows: [
      {
        kind: "merged",
        context,
        facts: {
          context,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: "APPROVED",
          headRefOid: "head",
          headRefName: "feature",
          baseRefName: "main",
          state: "MERGED",
          mergedAt: "now",
          isDraft: false,
          requestedReviewers: [],
        },
      },
    ],
  } satisfies WatcherVerdict;

  it("emits compact valid JSON by default", () => {
    const rendered = renderJson(status);
    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(status);
  });

  it("renders the Markdown table from the same verdict only", () => {
    const rendered = renderPretty(status);
    expect(rendered).toContain("| PR | CI | Review | Merge |");
    expect(rendered).toContain(
      "| [#1](https://github.com/owner/repo/pull/1) | \u2014 | \u2014 | ✅ merged |"
    );
  });
});

describe("main", () => {
  it("returns EX_USAGE 64 and writes usage errors only to stderr", async () => {
    const harness = testRuntime(fakeReader());
    expect(await main(["--interval", "0"], harness.runtime)).toBe(64);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr.join("")).toContain(
      "option '--interval <seconds>' argument '0' is invalid"
    );
  });

  it("bypasses the queue machine for queued-stack status-only", async () => {
    const reader = fakeReader();
    const harness = testRuntime(reader);
    const code = await main(
      [
        "--owner",
        "owner",
        "--repo",
        "repo",
        "--queued-stack",
        "--stack-prs",
        "1",
        "--status-only",
      ],
      harness.runtime
    );
    expect(code).toBe(0);
    expect(harness.stdout).toHaveLength(1);
    const verdict: unknown = JSON.parse(harness.stdout[0]);
    expect(verdict).toMatchObject({
      kind: "STATUS",
      terminal: true,
      exitCode: 0,
      mode: "queued-stack",
    });
    expect(harness.stdout[0]).not.toContain('"kind":"QUEUE"');
  });

  it("reports a status-only query failure once without retrying", async () => {
    const reader = fakeReader({
      fastPath: {
        kind: "unusable",
        exitCode: 1,
        stderr: "no checks reported on the 'feature' branch",
      },
    });
    const harness = testRuntime(reader);
    const code = await main(
      ["--owner", "owner", "--repo", "repo", "--pr", "1", "--status-only"],
      harness.runtime
    );
    expect(code).toBe(7);
    expect(harness.stdout).toHaveLength(1);
    expect(JSON.parse(harness.stdout[0])).toMatchObject({
      kind: "BLOCKER",
      blocker: { kind: "status-query", failures: 1 },
    });
  });

  it("returns exit 4 for a hidden GitHub-side CI refusal", async () => {
    const reader = fakeReader({
      facts: { mergeStateStatus: "BLOCKED" },
      fastPath: { kind: "checks", checks: [passingCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    });
    const harness = testRuntime(reader);
    const code = await main(
      ["--owner", "owner", "--repo", "repo", "--pr", "1"],
      harness.runtime
    );
    expect(code).toBe(4);
    expect(harness.stdout).toHaveLength(1);
    expect(JSON.parse(harness.stdout[0])).toMatchObject({
      kind: "BLOCKER",
      exitCode: 4,
      blocker: {
        kind: "failing-checks",
        ci: { kind: "ci-github-rejected" },
      },
    });
  });

  describe("--once", () => {
    const repo = ["--owner", "owner", "--repo", "repo"];
    const queued = [...repo, "--queued-stack", "--stack-prs", "1", "--once"];
    const lastVerdict = (stdout: readonly string[]): unknown =>
      JSON.parse(stdout[stdout.length - 1] ?? "null");

    it("ends pending checks in one TIMEOUT without sleeping", async () => {
      const harness = testRuntime(
        fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck()] } })
      );
      expect(await main([...repo, "--pr", "1", "--once"], harness.runtime)).toBe(
        5
      );
      expect(harness.stdout).toHaveLength(1);
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "TIMEOUT",
        exitCode: 5,
        reason: { kind: "pending-checks" },
      });
    });

    it("returns READY for a green PR", async () => {
      const harness = testRuntime(fakeReader());
      expect(await main([...repo, "--pr", "1", "--once"], harness.runtime)).toBe(
        0
      );
      expect(harness.stdout).toHaveLength(1);
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "READY",
        exitCode: 0,
      });
    });

    const noChecksYet = {
      fastPath: {
        kind: "unusable",
        exitCode: 1,
        stderr: "no checks reported on the 'feature' branch",
      },
    } as const;
    const unavailable = {
      kind: "TIMEOUT",
      exitCode: 5,
      reason: {
        kind: "status-unavailable",
        failure: { kind: "checks-unavailable" },
      },
    };

    it("ends a retryable query failure in TIMEOUT without a RETRY line", async () => {
      const harness = testRuntime(fakeReader(noChecksYet));
      expect(await main([...repo, "--pr", "1", "--once"], harness.runtime)).toBe(
        5
      );
      expect(harness.stdout).toHaveLength(1);
      expect(lastVerdict(harness.stdout)).toMatchObject(unavailable);
    });

    it("ends a retryable queued query failure in TIMEOUT", async () => {
      const harness = testRuntime(fakeReader(noChecksYet));
      expect(await main(queued, harness.runtime)).toBe(5);
      expect(harness.stdout.join("")).not.toContain('"kind":"RETRY"');
      expect(lastVerdict(harness.stdout)).toMatchObject(unavailable);
    });

    it("ends a retryable stack discovery failure in TIMEOUT", async () => {
      const base = fakeReader();
      const reader = {
        ...base,
        async openPullRequests(): Promise<readonly OpenPullRequest[]> {
          throw new WatcherQueryError({
            kind: "command-exit",
            retryable: true,
            code: 1,
            detail: "rate limited",
          });
        },
      } satisfies GitHubReader;
      const harness = testRuntime(reader);
      expect(
        await main([...repo, "--pr", "1", "--stack", "--once"], harness.runtime)
      ).toBe(5);
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "TIMEOUT",
        reason: { kind: "status-unavailable", failure: { kind: "command-exit" } },
      });
    });

    it("keeps a non-retryable query failure a status-query BLOCKER", async () => {
      const base = fakeReader();
      const reader = {
        ...base,
        async pullRequest(): Promise<PullRequestFacts> {
          throw new WatcherQueryError({
            kind: "invalid-context-url",
            retryable: false,
            detail: "not a GitHub PR URL",
            rawValue: "x",
          });
        },
      } satisfies GitHubReader;
      const harness = testRuntime(reader);
      expect(await main([...repo, "--pr", "1", "--once"], harness.runtime)).toBe(
        7
      );
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "BLOCKER",
        blocker: { kind: "status-query", failures: 1 },
      });
    });

    it("names the stack frontier whose checks are pending", async () => {
      const base = fakeReader({
        openPullRequests: [
          {
            number: parsePrNumber(1),
            isCrossRepository: false,
            headRefName: "a",
            baseRefName: "main",
          },
          {
            number: parsePrNumber(2),
            isCrossRepository: false,
            headRefName: "b",
            baseRefName: "a",
          },
        ],
      });
      const pending: ChecksFastPath = { kind: "checks", checks: [pendingCheck()] };
      const reader = {
        ...base,
        async checksFastPath(pr: PrContext): Promise<ChecksFastPath> {
          return pr.number === 2 ? pending : base.checksFastPath(pr);
        },
      } satisfies GitHubReader;
      const harness = testRuntime(reader);
      expect(
        await main([...repo, "--pr", "1", "--stack", "--once"], harness.runtime)
      ).toBe(5);
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "TIMEOUT",
        reason: { kind: "pending-checks", frontier: { number: 2 } },
      });
    });

    it("shows a required review and its requested reviewers on READY", async () => {
      const harness = testRuntime(
        fakeReader({
          facts: {
            reviewDecision: "REVIEW_REQUIRED",
            requestedReviewers: ["octocat", "org/core"],
          },
        })
      );
      expect(await main([...repo, "--pr", "1", "--once"], harness.runtime)).toBe(
        0
      );
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "READY",
        scope: {
          pr: {
            proof: {
              gate: {
                reviewDecision: "REVIEW_REQUIRED",
                requestedReviewers: ["octocat", "org/core"],
              },
            },
          },
        },
      });
    });

    it("says what an unmerged queued frontier waits on", async () => {
      const cases: readonly {
        readonly reader: FakeReaderOptions;
        readonly waitingOn: unknown;
      }[] = [
        {
          reader: { fastPath: { kind: "checks", checks: [pendingCheck()] } },
          waitingOn: { kind: "pending-checks", pending: [{ name: "ci" }] },
        },
        {
          reader: {
            facts: {
              reviewDecision: "REVIEW_REQUIRED",
              requestedReviewers: ["octocat"],
            },
          },
          waitingOn: { kind: "review-required", requestedReviewers: ["octocat"] },
        },
        { reader: {}, waitingOn: { kind: "merge" } },
      ];
      for (const { reader, waitingOn } of cases) {
        const harness = testRuntime(fakeReader(reader));
        expect(await main(queued, harness.runtime)).toBe(5);
        expect(lastVerdict(harness.stdout)).toMatchObject({
          kind: "TIMEOUT",
          reason: { kind: "queued-stack", frontier: { number: 1 }, waitingOn },
        });
      }
    });

    it("renders what a queued frontier waits on", async () => {
      const harness = testRuntime(
        fakeReader({
          facts: {
            reviewDecision: "REVIEW_REQUIRED",
            requestedReviewers: ["octocat"],
          },
        })
      );
      expect(await main([...queued, "--pretty"], harness.runtime)).toBe(5);
      expect(harness.stdout[harness.stdout.length - 1]).toBe(
        "TIMEOUT: queued stack still has 1 PR unmerged; frontier=#1; waiting on review from octocat\n"
      );
    });

    it("ends an unmerged queued stack in TIMEOUT", async () => {
      const harness = testRuntime(
        fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck()] } })
      );
      expect(await main(queued, harness.runtime)).toBe(5);
      expect(harness.stdout.join("")).not.toContain('"kind":"WAITING"');
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "TIMEOUT",
        exitCode: 5,
        reason: { kind: "queued-stack", unmergedCount: 1 },
      });
    });

    it("completes a fully merged queued stack", async () => {
      const harness = testRuntime(
        fakeReader({ facts: { state: "MERGED", mergedAt: "now" } })
      );
      expect(await main(queued, harness.runtime)).toBe(0);
      expect(lastVerdict(harness.stdout)).toMatchObject({
        kind: "COMPLETE",
        exitCode: 0,
      });
    });
  });

  it("shows help without touching the reader", async () => {
    const reader = fakeReader();
    const harness = testRuntime(reader);
    expect(await main(["--help"], harness.runtime)).toBe(0);
    expect(harness.stdout.join("")).toContain("JSON (NDJSON while polling)");
    expect(reader.calls).toEqual([]);
  });
});
