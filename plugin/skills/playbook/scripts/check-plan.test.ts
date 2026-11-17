import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";

const checker = join(import.meta.dir, "check-plan.mjs");
const rule =
	"Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";

const validPlan = `# Demo

## How to read this
One box is one unit of work and names the evidence. Check a box only when its evidence exists. See playbooks/.
${rule}

## Program checklist
### Arm the program
### Spawn owners
### PR mechanics
### Verdict and merge
### Boot recipe
\`git show origin/main:\` /loop 1h status message

## PR 1
**Depends on.** None.
**Files.**
- [ ] Do the thing.
**Build.**
- [ ] Do the thing.
**You see.**
- [ ] Do the thing.
**Verify, unit.** ${rule}
- [ ] Check the thing.
**Verify, live.** ${rule} Ten lanes on \`example-model\` at the PR head
${Array.from({ length: 10 }, (_, i) => `- [ ] Lane ${i + 1}. Save \`lane-${i + 1}.png\`. Pass when evidence exists.`).join("\n")}
**Verify, perf.** ${rule}
- [ ] Metric. Recorded.
- [ ] Probe. Recorded.
- [ ] Baseline. Recorded.
- [ ] Rule. Recorded.
**Review gate.** None.
**Merge.**
- [ ] Merge when approved.

## Close the program
Close.

## Appendix Prototype evidence
Recorded.
`;

const run = (...args: string[]) => spawnSync("node", [checker, ...args], { encoding: "utf8" });

const check = (plan: string) => {
	const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
	const file = join(directory, "plan.md");
	writeFileSync(file, plan);
	try {
		return run(file);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

const runPlan = (example: string, expectedExit: number) => {
	const result = check(validPlan + example);
	expect(result.status).toBe(expectedExit);
	return result;
};

const expectUsage = (result: ReturnType<typeof run>) => {
	expect(result.status).toBe(2);
	expect(result.stderr).toContain("Usage: node check-plan.mjs <plan.md>");
	expect(result.stderr).not.toMatch(/^\s+at /m);
};

test("prints usage and exits 2 for --help, -h, and no argument", () => {
	for (const args of [["--help"], ["-h"], []]) expectUsage(run(...args));
});

test("prints usage and exits 2 for a missing or unreadable file", () => {
	const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
	try {
		const missing = run(join(directory, "missing.md"));
		expectUsage(missing);
		expect(missing.stderr).toContain("missing.md: ENOENT");
		const folder = run(directory);
		expectUsage(folder);
		expect(folder.stderr).toContain("EISDIR");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

const replace = (from: string | RegExp, to: string) => (plan: string) => plan.replace(from, to);
const gate = (body: string) => replace("**Review gate.** None.", `**Review gate.** The operator reviews.\n${body}`);

const structureRules: { name: string; mutate: (plan: string) => string; message: string }[] = [
	{ name: "no H1", mutate: replace("# Demo\n", ""), message: "no H1 title" },
	{ name: "missing How to read this", mutate: replace("## How to read this", "## Reading"), message: 'no "## How to read this" section' },
	...["One box is one unit of work", "names the evidence", "Check a box only when its evidence exists", "playbooks/", rule].map((marker) => ({
		name: `How to read this without "${marker.slice(0, 30)}"`,
		mutate: replace(marker, "removed"),
		message: `How to read this lacks "${marker}"`,
	})),
	{ name: "intro of ten lines", mutate: replace("# Demo\n", `# Demo\n${"Intro line.\n".repeat(10)}`), message: "intro is 10 lines, under ten required" },
	{ name: "missing Program checklist", mutate: replace("## Program checklist", "## Program"), message: 'no "## Program checklist" section' },
	{ name: "Program H3 out of order", mutate: replace("### Arm the program\n### Spawn owners", "### Spawn owners\n### Arm the program"), message: 'Program checklist lacks "### Spawn owners" in order' },
	...["git show origin/main:", "/loop 1h", "status message"].map((marker) => ({
		name: `Program checklist without "${marker}"`,
		mutate: replace(marker, "removed"),
		message: `Program checklist lacks "${marker}"`,
	})),
	{ name: "missing Close the program", mutate: replace("## Close the program", "## Close"), message: 'no "## Close the program" section' },
	{ name: "no PR sections", mutate: replace(/## PR 1[\s\S]*?(?=## Close)/, ""), message: "no PR sections between Program checklist and Close the program" },
	{
		name: "sub-blocks out of order",
		mutate: (plan) => plan.replace("**Depends on.** None.\n", "").replace("**Merge.**", "**Depends on.** None.\n**Merge.**"),
		message: "PR 1: sub-blocks are [Files., Build., You see., Verify, unit., Verify, live., Verify, perf., Review gate., Depends on., Merge.]",
	},
	{ name: "empty Depends on", mutate: replace("**Depends on.** None.", "**Depends on.**"), message: "PR 1: Depends on names nothing" },
	...["Files.", "Build.", "You see.", "Verify, unit.", "Merge."].map((block) => ({
		name: `${block} with no box`,
		mutate: (plan: string) => {
			const lines = plan.split("\n");
			lines.splice(lines.findIndex((line) => line.startsWith(`**${block}**`)) + 1, 1);
			return lines.join("\n");
		},
		message: `PR 1: ${block} has no box`,
	})),
	...["Verify, unit.", "Verify, live.", "Verify, perf."].map((block) => ({
		name: `${block} without the rule`,
		mutate: replace(`**${block}** ${rule}`, `**${block}** Tests pass.`),
		message: `PR 1: ${block} does not open with the rule`,
	})),
	{ name: "Verify, live without Ten lanes", mutate: replace(" Ten lanes on `example-model` at the PR head", ""), message: "PR 1: Verify, live lacks" },
	{ name: "Verify, live with an unfilled model", mutate: replace("`example-model`", "`<code model>`"), message: "PR 1: Verify, live lacks" },
	{ name: "lanes not 1 to 10", mutate: replace("Lane 10.", "Lane 11."), message: "PR 1: lanes are [1,2,3,4,5,6,7,8,9,11], expected 1 to 10" },
	{ name: "live box that is not a lane", mutate: replace("**Verify, perf.**", "- [ ] Look around.\n**Verify, perf.**"), message: "PR 1: live box is not a lane" },
	{ name: "lane with no screenshot", mutate: replace("Save `lane-3.png`", "Look"), message: "PR 1: lane 3 names no screenshot" },
	{ name: "lane with no pass predicate", mutate: replace("Save `lane-4.png`. Pass when evidence exists.", "Save `lane-4.png`. Done."), message: "PR 1: lane 4 has no pass predicate" },
	{
		name: "perf boxes out of order",
		mutate: replace("- [ ] Metric. Recorded.\n- [ ] Probe. Recorded.", "- [ ] Probe. Recorded.\n- [ ] Metric. Recorded."),
		message: "PR 1: perf boxes are [Probe., Metric., Baseline., Rule.], expected [Metric., Probe., Baseline., Rule.]",
	},
	{ name: "Review gate None with boxes", mutate: replace("**Review gate.** None.\n", "**Review gate.** None.\n- [ ] Review it.\n"), message: "PR 1: Review gate says None but has boxes" },
	{ name: "Review gate with no box", mutate: gate("Post the screenshot and video for the operator."), message: "PR 1: Review gate has no box" },
	...["screenshot", "video", "operator"].map((word) => ({
		name: `Review gate without "${word}"`,
		mutate: gate(`- [ ] ${"Post the screenshot and video for the operator.".replace(word, "item")}`),
		message: `PR 1: Review gate lacks "${word}"`,
	})),
	{ name: "non-appendix after Close", mutate: (plan) => `${plan}\n## Notes\nRecorded.\n`, message: '"## Notes" after Close the program is not an appendix' },
	{ name: "no Prototype evidence appendix", mutate: replace("## Appendix Prototype evidence", "## Appendix Risks"), message: 'no "## Appendix ... Prototype evidence" section' },
];

test.each(structureRules)("rejects $name", ({ mutate, message }) => {
	const plan = mutate(validPlan);
	expect(plan).not.toBe(validPlan);
	const result = check(plan);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain(message);
});

test("the multi-phase-plan skeleton passes once its model is filled in", () => {
	const playbook = readFileSync(join(import.meta.dir, "../playbooks/multi-phase-plan.md"), "utf8");
	const skeleton = playbook.match(/^````markdown\n([\s\S]*?)^````$/m)?.[1];
	expect(skeleton).toBeDefined();
	const raw = check(skeleton ?? "");
	expect(raw.status).toBe(1);
	const problems = raw.stderr.trim().split("\n");
	expect(problems).toHaveLength(1);
	expect(problems[0]).toContain("Verify, live lacks");
	const filled = check((skeleton ?? "").replaceAll("<code model>", "example-model"));
	expect(filled.stderr).toBe("");
	expect(filled.status).toBe(0);
});

test("accepts ordinary, indented, and longer closing fences", () => {
	for (const indent of ["", " ", "  ", "   "])
		runPlan(`${indent}\`\`\`markdown\n## Example only\n${indent}\`\`\`\n`, 0);
	runPlan("```markdown\n## Example only\n````\n", 0);
});

test("accepts nested backticks and tilde info strings", () => {
	runPlan("````markdown\n```markdown\n## Example only\n```\n````\n", 0);
	runPlan("~~~markdown `info`\n## Example only\n ~~~\n", 0);
});

test("keeps mismatched, shorter, and suffixed closers inside the fence", () => {
	runPlan("````markdown\n~~~\n## Example only\n````\n", 0);
	runPlan("````markdown\n```\n## Example only\n````\n", 0);
	runPlan("````markdown\n``` info\n## Example only\n````\n", 0);
});

test("rejects headings and prose outside a proper close", () => {
	for (const suffix of ["  ", "\t"]) {
		const heading = runPlan(`\`\`\`markdown\n## Example only\n\`\`\`${suffix}\n## Example only\n`, 1);
		expect(heading.stderr).toContain('"## Example only" after Close the program is not an appendix');
	}

	const prose = runPlan("```markdown\nThis prose has a mid-sentence colon: inside code\n```\nThis prose has a mid-sentence colon: bad.\n", 1);
	expect(prose.stderr).toContain("mid-sentence colon");
});

test("rejects backtick info strings containing a backtick", () => {
	const result = runPlan("```markdown `invalid`\n## Example only\n```\n", 1);
	expect(result.stderr).toContain('"## Example only" after Close the program is not an appendix');
});

test("ignores prose punctuation inside matching multi-backtick code spans", () => {
	for (const count of [2, 3, 4]) {
		const delimiter = "`".repeat(count);
		runPlan(`Use ${delimiter}echo \`x\`: “quoted” — example${delimiter}.\n`, 0);
	}
});

test("checks prose following a multi-backtick span and unmatched delimiters", () => {
	const outside = runPlan("Use ``echo `x`: y``. Bad: prose.\n", 1);
	expect(outside.stderr).toContain("mid-sentence colon");
	const unmatched = runPlan("Use ``unclosed: bad` here.\n", 1);
	expect(unmatched.stderr).toContain("mid-sentence colon");
});
