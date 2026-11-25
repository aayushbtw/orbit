import rough from 'roughjs';
import { readFileSync, writeFileSync } from 'node:fs';

const themes = {
  light: { ink: '#1e1e1e', muted: '#5c5f66', you: '#e5dbff', claude: '#d0ebff', agent: '#fff3bf', done: '#d3f9d8', fail: '#ffc9c9' },
  dark: { ink: '#e3e3e8', muted: '#a6a8ae', you: '#2e2550', claude: '#13304a', agent: '#3b3214', done: '#173d22', fail: '#4a1d1d' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rr = (x, y, w, h, r) =>
  `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;

function canvas(theme, W, H) {
  const c = themes[theme];
  const g = rough.generator();
  const out = [];
  let seed = 7;
  const o = (extra) => ({ seed: seed++, stroke: c.ink, strokeWidth: 1.6, roughness: 1.1, bowing: 1, ...extra });
  const draw = (d, dash) => {
    for (const p of g.toPaths(d)) {
      out.push(`<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}" stroke-linecap="round"${dash && p.fill === 'none' ? ' stroke-dasharray="8 7"' : ''}/>`);
    }
  };
  const text = (x, y, s, size, color = c.ink, anchor = 'middle') => {
    out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`);
  };
  const api = {
    c,
    text,
    box(b) {
      draw(g.path(rr(b.x, b.y, b.w, b.h, 16), o({ fill: c[b.kind], fillStyle: 'solid' })), b.optional);
      const ts = b.ts ?? 24;
      text(b.x + b.w / 2, b.y + b.h / 2 + (b.s ? -2 : ts / 3), b.t, ts);
      if (b.s) text(b.x + b.w / 2, b.y + b.h / 2 + 24, b.s, b.ss ?? 17, c.muted);
    },
    link(a, b, dashed) {
      const dy = b.cy - a.cy;
      const spread = (h) => Math.max(-h / 4, Math.min(h / 4, dy * 0.2));
      const s = [a.r + 6, a.cy + spread(a.h)], e = [b.x - 6, b.cy - spread(b.h)];
      if (dy === 0) return api.arrow([s, e], dashed);
      const dx = e[0] - s[0];
      api.arrow([s, [s[0] + dx * 0.3, s[1] + dy * 0.1], [e[0] - dx * 0.3, e[1] - dy * 0.1], e], dashed);
    },
    line(x1, y1, x2, y2) {
      draw(g.line(x1, y1, x2, y2, o({ roughness: 0.8, strokeWidth: 1.2, stroke: c.muted })), true);
    },
    frame(x, y, w, h, label) {
      draw(g.path(rr(x, y, w, h, 20), o({ roughness: 0.9, strokeWidth: 1.2, stroke: c.muted })), true);
      text(x + 18, y + 26, label, 18, c.muted, 'start');
    },
    arrow(pts, dashed) {
      draw(pts.length === 2 ? g.line(...pts[0], ...pts[1], o({ roughness: 0.7 })) : g.curve(pts, o({ roughness: 0.7 })), dashed);
      const [x2, y2] = pts.at(-1), [x1, y1] = pts.at(-2);
      const a = Math.atan2(y2 - y1, x2 - x1);
      for (const d of [a + Math.PI - 0.45, a + Math.PI + 0.45]) {
        draw(g.line(x2, y2, x2 + 13 * Math.cos(d), y2 + 13 * Math.sin(d), o({ roughness: 0.5 })));
      }
    },
    svg(font) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>@font-face{font-family:Excalifont;src:url(data:font/woff2;base64,${font}) format("woff2")}text{font-family:Excalifont,"Comic Sans MS",cursive}</style>
${out.join('\n')}
</svg>
`;
    },
  };
  return api;
}

const B = (b) => ({ ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.x + b.w, bot: b.y + b.h });

function readme(theme) {
  const W = 1340, H = 410;
  const k = canvas(theme, W, H);
  for (const [name, y0, y1] of [['You', 20, 140], ['Orbit', 140, 270], ['Checks', 270, 400]]) k.text(16, (y0 + y1) / 2 + 8, name, 24, k.c.ink, 'start');
  k.line(10, 140, W - 10, 140);
  k.line(10, 270, W - 10, 270);

  const laneY = { you: 38, claude: 163, agent: 298 };
  const box = (lane, x, w, t, s, extra = {}) => { const b = B({ x, y: laneY[lane], w, h: 84, t, s, kind: lane, ...extra }); k.box(b); return b; };
  const start = box('you', 110, 170, '/orbit:start', 'you name a goal');
  const plan = box('claude', 230, 190, 'Plan it', 'flow and worktree');
  const write = box('claude', 460, 180, 'Write a unit', 'one small piece');
  const review = box('agent', 570, 180, 'Review it', 'read and run it');
  const commit = box('claude', 680, 170, 'Commit it', 'one per unit');
  const verify = box('agent', 830, 230, 'Run it like a user', 'a fresh agent', { ts: 22 });
  const land = box('claude', 1000, 170, 'Land it', 'on PASS', { kind: 'done' });
  const fail = box('agent', 1120, 200, 'Nothing lands', 'on FAIL, with a repro', { kind: 'fail', ss: 16 });
  const next = box('you', 1130, 180, 'Reply', 'what landed', { kind: 'done' });

  k.arrow([[start.x + 140, start.bot + 6], [plan.x + 30, plan.y - 6]]);
  k.arrow([[plan.r + 6, plan.cy], [write.x - 6, write.cy]]);
  k.arrow([[write.x + 150, write.bot + 6], [review.x + 40, review.y - 6]]);
  k.arrow([[review.x + 140, review.y - 6], [commit.x + 30, commit.bot + 6]]);
  k.arrow([[commit.cx, commit.y - 6], [(commit.cx + write.cx) / 2, commit.y - 46], [write.cx + 10, write.y - 6]]);
  k.text((commit.cx + write.cx) / 2, commit.y - 58, 'next unit', 18, k.c.muted);
  k.arrow([[commit.x + 150, commit.bot + 6], [verify.x + 40, verify.y - 6]]);
  k.arrow([[verify.x + 190, verify.y - 6], [land.x + 30, land.bot + 6]]);
  k.arrow([[verify.r + 6, verify.cy], [fail.x - 6, fail.cy]]);
  k.arrow([[land.x + 150, land.y - 6], [next.x + 30, next.bot + 6]]);
  return k;
}

function docs(theme) {
  const W = 960, H = 1640;
  const k = canvas(theme, W, H);
  const col = { you: [20, 190], claude: [200, 560], agent: [570, 940] };
  const cx = (lane) => (col[lane][0] + col[lane][1]) / 2;
  k.text(cx('you'), 44, 'You', 28);
  k.text(cx('claude'), 44, 'Claude', 28);
  k.text(cx('agent'), 44, 'Subagents', 28);
  k.line(195, 16, 195, H - 60);
  k.line(565, 16, 565, H - 60);
  k.line(10, 68, W - 10, 68);

  const rowY = (r) => 90 + r * 108;
  const box = (lane, r, t, s, extra = {}) => {
    const w = lane === 'you' ? 166 : 250;
    const b = B({ x: cx(lane) - w / 2, y: rowY(r), w, h: 80, t, s, kind: lane, ...extra });
    k.box(b);
    return b;
  };
  const down = (a, b, dashed) => {
    if (a.cx === b.cx) return k.arrow([[a.cx, a.bot + 6], [b.cx, b.y - 6]], dashed);
    const dir = Math.sign(b.cx - a.cx);
    const sx = dir > 0 ? a.r + 6 : a.x - 6;
    k.arrow([[sx, a.cy], [b.cx - dir * 40, a.cy + 6], [b.cx, a.cy + 40], [b.cx, b.y - 6]], dashed);
  };

  const start = box('you', 0, '/orbit:start', 'you name the goal');
  const pick = box('claude', 1, 'Pick the flow', 'bug, feature, perf…');
  const answer = box('you', 1, 'Answer', 'a question stops', { kind: 'done', optional: true });
  const wt = box('claude', 2, 'Worktree', 'off origin/main');
  const guidance = box('claude', 3, 'Read project guidance', 'rules for the paths in scope');
  k.frame(205, rowY(4) - 10, 730, 2 * 108 + 100, 'repeats for each unit');
  const write = box('agent', 4, 'Write a unit', 'poteto-agent');
  const review = box('claude', 5, 'Review it', 'reads and runs it');
  const commit = box('agent', 6, 'Commit', 'gitops');
  const inter = box('agent', 7, 'Interrogate', 'contested design only', { optional: true });
  const deslop = box('claude', 8, 'Deslop', 'cut AI slop');
  const sicko = box('agent', 8, 'Strip comments', 'comment-sicko');
  const pr = box('agent', 9, 'PR or branch', 'gitops');
  const stop = box('you', 9, 'Run', '/orbit:ship', { kind: 'done', optional: true });
  const baby = box('claude', 10, 'Babysit', 'Land pr: to merge-ready', { optional: true });
  const verify = box('agent', 11, 'Verify', 'fresh verifier');
  const fail = box('claude', 11, 'Nothing lands', 'FAIL, with a repro', { kind: 'fail' });
  const land = box('agent', 12, 'Land', 'gitops merges or pushes');
  const next = box('you', 13, 'Reply', 'what landed', { kind: 'done' });

  down(start, pick);
  k.arrow([[pick.x - 6, pick.cy], [answer.r + 6, answer.cy]], true);
  k.arrow([[pick.cx, pick.bot + 6], [wt.cx, wt.y - 6]]);
  down(wt, guidance);
  down(guidance, write);
  down(write, review);
  down(review, commit);
  k.arrow([[commit.r + 6, commit.cy], [commit.r + 36, (commit.cy + write.cy) / 2], [write.r + 6, write.cy]]);
  k.arrow([[commit.cx, commit.bot + 6], [inter.cx, inter.y - 6]], true);
  down(inter, deslop);
  k.arrow([[deslop.r + 6, deslop.cy], [sicko.x - 6, sicko.cy]]);
  k.arrow([[sicko.cx, sicko.bot + 6], [pr.cx, pr.y - 6]]);
  k.arrow([[pr.x - 6, pr.cy], [stop.r + 6, stop.cy]], true);
  k.text(cx('claude'), pr.cy - 12, "said don't ship", 18, k.c.muted);
  down(pr, baby, true);
  down(baby, verify);
  k.arrow([[verify.cx, verify.bot + 6], [land.cx, land.y - 6]]);
  k.text(verify.cx + 14, verify.bot + 22, 'PASS or PASS+NOTES', 17, k.c.muted, 'start');
  k.arrow([[verify.x - 6, verify.cy], [fail.r + 6, fail.cy]]);
  k.text(598, verify.cy - 12, 'FAIL', 17, k.c.muted);
  k.arrow([[land.x - 6, land.cy], [next.cx + 40, land.cy + 8], [next.cx, land.cy + 50], [next.cx, next.y - 6]]);
  k.text(W - 20, H - 24, 'dashed: only when it applies', 18, k.c.muted, 'end');
  return k;
}

function guideArena(theme) {
  const W = 880, H = 890;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ h: 84, ...b }); k.box(r); return r; };
  const frame = box({ x: 290, y: 20, w: 240, t: 'Frame', s: 'one prompt, one rubric', kind: 'claude' });
  k.frame(20, 140, 780, 160, '2+ candidates in parallel');
  const cands = ['A', 'B', 'C'].map((n, i) =>
    box({ x: 45 + i * 270, y: 194, w: 190, t: `Candidate ${n}`, s: n === 'C' ? 'more if needed' : 'own worktree', kind: 'agent', optional: n === 'C' }));
  k.frame(110, 340, 600, 140, 'at the same time');
  box({ x: 130, y: 382, w: 260, t: 'Judge', s: 'skipped if no other model', kind: 'agent', optional: true });
  box({ x: 430, y: 382, w: 260, t: 'Claude reads all', s: 'scores them too', kind: 'claude' });
  const pick = box({ x: 290, y: 520, w: 240, t: 'Pick a base', s: 'easiest to extend', kind: 'claude' });
  const graft = box({ x: 290, y: 650, w: 240, t: 'Graft', s: 'into the base', kind: 'claude' });
  const verify = box({ x: 290, y: 780, w: 240, t: 'Verify', s: 'same proof as any change', kind: 'done' });

  const ends = [cands[0].r - 15, cands[1].cx, cands[2].x + 15];
  cands.forEach((c, i) => k.arrow([[frame.cx + (i - 1) * 60, frame.bot + 6], [ends[i], c.y - 8]]));
  const targets = [200, 410, 620];
  cands.forEach((c, i) => k.arrow([[c.cx, c.bot + 6], [targets[i], 334]]));
  k.arrow([[410, 486], [pick.cx, pick.y - 6]]);
  k.arrow([[pick.cx, pick.bot + 6], [graft.cx, graft.y - 6]]);
  k.arrow([[graft.cx, graft.bot + 6], [verify.cx, verify.y - 6]]);
  k.arrow([[806, 220], [850, 420], [780, 650], [graft.r + 6, graft.cy]], true);
  k.text(790, 560, '1 or 2 parts', 17, k.c.muted, 'end');
  k.text(790, 582, 'from each loser', 17, k.c.muted, 'end');
  return k;
}

function guideShip(theme) {
  const W = 1385, H = 400;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ h: 84, ...b }); k.box(r); return r; };
  const opening = box({ x: 20, y: 115, w: 210, t: 'Opening a PR', s: 'deslop, no-comments', kind: 'claude' });
  const pr = box({ x: 290, y: 25, w: 220, t: 'Open a PR', s: 'ready, not a draft', kind: 'claude' });
  const branch = box({ x: 290, y: 205, w: 220, t: 'Keep the branch', s: 'local, unpushed', kind: 'claude' });
  const review = box({ x: 650, y: 115, w: 215, t: 'Diff review', s: 'advisor reads the diff', kind: 'agent' });
  const verifier = box({ x: 910, y: 115, w: 215, t: 'Verifier', s: 'fresh, runs it like a user', kind: 'agent' });
  const lands = box({ x: 1170, y: 25, w: 200, t: 'Lands', s: 'PASS or PASS+NOTES', ss: 16, kind: 'done' });
  const waits = box({ x: 1170, y: 205, w: 200, t: 'Nothing lands', s: 'FAIL, with a repro', ss: 16, kind: 'fail' });
  k.link(opening, pr);
  k.link(opening, branch);
  k.text(222, 100, 'Land pr', 17, k.c.muted, 'end');
  k.text(222, 228, 'Land main', 17, k.c.muted, 'end');
  k.link(pr, review);
  k.link(branch, review);
  k.link(review, verifier);
  k.arrow([[review.cx + 40, review.bot + 6], [review.cx + 30, review.bot + 48], [review.cx - 30, review.bot + 48], [review.cx - 40, review.bot + 6]], true);
  k.text(review.cx, review.bot + 74, 'a blocking finding gets a fix', 17, k.c.muted);
  k.link(verifier, lands);
  k.link(verifier, waits);
  k.line(545, 15, 545, 305);
  k.text(545, 335, "don't ship stops here", 17, k.c.muted);
  k.text(545, 358, '/orbit:ship resumes', 17, k.c.muted);
  k.text(565, 76, 'Babysit', 17, k.c.muted, 'start');
  return k;
}

function guideAutopilot(theme) {
  const W = 1160, H = 500;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ h: 84, ...b }); k.box(r); return r; };
  const queue = box({ x: 20, y: 160, w: 180, t: 'Queue', s: 'your items', kind: 'you' });
  const root = box({ x: 240, y: 160, w: 190, t: 'Main thread', s: 'runs the queue', kind: 'claude' });
  const owners = ['A', 'B', 'C'].map((n, i) => box({ x: 475, y: 30 + i * 130, w: 210, t: `Owner ${n}`, s: 'builds and opens PR', kind: 'agent' }));
  const ver = box({ x: 730, y: 30, w: 170, h: 344, t: 'Verifiers', kind: 'agent' });
  ['live proof', 'and diff review', 'at code-ready'].forEach((l, i) => k.text(ver.cx, ver.cy + 34 + i * 22, l, 17, k.c.muted));
  const full = box({ x: 945, y: 70, w: 200, t: 'autopilot-full', s: 'main thread merges', kind: 'done' });
  const stack = box({ x: 945, y: 250, w: 200, t: 'autopilot-stack', s: 'you land the stack', kind: 'you' });
  k.link(queue, root);
  owners.forEach((o) => {
    k.link(root, o);
    k.arrow([[o.r + 6, o.cy], [ver.x - 6, o.cy]]);
  });
  k.arrow([[ver.r + 6, full.cy], [full.x - 6, full.cy]]);
  k.arrow([[ver.r + 6, stack.cy], [stack.x - 6, stack.cy]]);
  const c = owners[2];
  k.arrow([[root.cx, root.bot + 6], [root.cx + 30, c.bot + 50], [c.cx - 40, c.bot + 50], [c.cx - 10, c.bot + 6]], true);
  k.text(440, c.bot + 84, 'audit tick checks for stalls', 17, k.c.muted);
  k.arrow([[ver.cx, ver.bot + 6], [ver.cx - 20, ver.bot + 46], [c.r + 20, c.bot + 46], [c.r - 14, c.bot + 6]], true);
  k.text(770, c.bot + 84, 'findings go back to the owner', 17, k.c.muted);
  return k;
}

function guideStack(theme) {
  const W = 830, H = 580;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ x: 230, w: 260, h: 84, ...b }); k.box(r); return r; };
  k.frame(200, 20, 320, 254, 'waits');
  const pr4 = box({ y: 60, t: 'PR 4', s: 'PASS', kind: 'agent' });
  box({ y: 174, t: 'PR 3', s: 'FAIL', kind: 'fail' });
  k.frame(200, 300, 320, 254, 'the run: lands bottom-up');
  const pr2 = box({ y: 340, t: 'PR 2', s: 'PASS+NOTES', kind: 'done' });
  box({ y: 454, t: 'PR 1', s: 'PASS', kind: 'done' });
  k.text(pr4.r + 50, pr4.cy + 6, 'passed, but needs PR 3 under it', 17, k.c.muted, 'start');
  k.arrow([[pr2.r + 100, pr2.cy], [pr2.r + 6, pr2.cy]]);
  k.text(pr2.r + 110, pr2.cy + 6, 'ceiling', 17, k.c.muted, 'start');
  k.arrow([[120, 520], [120, 380]]);
  k.text(120, 548, 'merge order', 17, k.c.muted);
  return k;
}

function guideArchitect(theme) {
  const W = 1100, H = 330;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ y: 100, w: 210, h: 84, kind: 'claude', ...b }); k.box(r); return r; };
  const trace = box({ x: 25, t: 'Trace', s: 'every system it touches' });
  const sketch = box({ x: 295, t: 'Sketch', s: 'two different shapes' });
  const pick = box({ x: 565, t: 'Pick', s: 'callers know least' });
  const build = box({ x: 835, t: 'Build', s: 'against the pick', kind: 'done' });
  k.link(trace, sketch);
  k.link(sketch, pick);
  k.link(pick, build);
  k.arrow([[trace.cx + 40, trace.y - 6], [trace.r + 30, 58], [build.x - 30, 58], [build.cx - 40, build.y - 6]], true);
  k.text(W / 2, 40, 'large or contested: /orbit:arena instead', 17, k.c.muted);
  k.arrow([[build.cx, build.bot + 6], [build.cx - 60, 262], [sketch.cx + 60, 262], [sketch.cx, sketch.bot + 6]], true);
  k.text((sketch.cx + build.cx) / 2, 298, 'workarounds repeat: redesign', 17, k.c.muted);
  return k;
}

function guideModels(theme) {
  const W = 1140, H = 560;
  const k = canvas(theme, W, H);
  const ask = (y, t, s, ss) => { const r = B({ x: 30, y, w: 500, h: 84, t, s, ss, kind: 'claude' }); k.box(r); return r; };
  const pick = (y, t, s, ss) => { const r = B({ x: 700, y, w: 410, h: 84, t, s, ss, kind: 'agent' }); k.box(r); return r; };
  const qs = [
    ask(30, 'Step picks its own?', 'model or effort, such as recall'),
    ask(170, 'Spawn names a role?', 'gitops, verifier, advisor, judgment, code, other-family', 15),
    ask(310, 'A work type fits?', 'any other poteto-agent unit'),
  ];
  const picks = [
    pick(30, 'Keep it', "recall's haiku, trail reviewer"),
    pick(170, "The role's row", 'empty cell falls through to user file, else default', 15),
    pick(310, "The work type's row", 'after <n> failed tries steps up'),
  ];
  const tier = B({ x: 30, y: 450, w: 500, h: 84, t: 'Tier by difficulty', s: 'hardest or prose: judgment, the rest: code', kind: 'agent' });
  k.box(tier);
  qs.forEach((q, i) => {
    k.arrow([[q.r + 6, q.cy], [picks[i].x - 6, picks[i].cy]]);
    k.text((q.r + picks[i].x) / 2, q.cy - 12, 'yes', 17, k.c.muted);
    const next = qs[i + 1] ?? tier;
    k.arrow([[q.cx, q.bot + 6], [next.cx, next.y - 6]]);
    k.text(q.cx + 14, (q.bot + next.y) / 2 + 6, 'no', 17, k.c.muted, 'start');
  });
  k.text(tier.r + 30, tier.cy - 4, 'with work types, the reply', 17, k.c.muted, 'start');
  k.text(tier.r + 30, tier.cy + 18, 'names the unit so you add a row', 17, k.c.muted, 'start');
  return k;
}

function t3Lead(theme) {
  const W = 1000, H = 672;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ h: 84, kind: 'claude', ...b }); k.box(r); return r; };
  const start = box({ x: 400, y: 20, w: 200, t: '/orbit:start', s: 'you name the goal', kind: 'you' });
  const lead = box({ x: 330, y: 150, w: 340, t: 'Claude lead', s: 'SessionStart hook printed the rules' });
  const play = box({ x: 380, y: 280, w: 240, t: 'Playbook', s: 'runs the flow' });
  k.frame(15, 410, 970, 160, 'what the lead spawns');
  const spawns = [
    box({ x: 25, y: 460, w: 300, t: 'orbit agent', s: 'native subagent, nested', kind: 'agent' }),
    box({ x: 350, y: 460, w: 300, t: 'Code child', s: 'Claude, like the lead', kind: 'agent' }),
    box({ x: 675, y: 460, w: 300, t: 'Panel seat', s: 'a provider you listed, delegate_task', ss: 15, kind: 'agent' }),
  ];
  k.arrow([[start.cx, start.bot + 6], [lead.cx, lead.y - 6]]);
  k.arrow([[lead.cx, lead.bot + 6], [play.cx, play.y - 6]]);
  const ends = [spawns[0].cx + 40, spawns[1].cx, spawns[2].cx - 40];
  ends.forEach((x, i) => k.arrow([[play.cx + (i - 1) * 60, play.bot + 6], [x, spawns[i].y - 8]]));
  k.text(W - 20, H - 50, 'a child that needs its own checkout, or runs while the lead works, goes through delegate_task', 17, k.c.muted, 'end');
  k.text(W - 20, H - 24, 'a panel seat runs only on providers you listed in /orbit:setup', 17, k.c.muted, 'end');
  return k;
}

function providerSelection(theme) {
  const k = canvas(theme, 1100, 810);
  const box = (b) => { const r = B({ h: 88, ss: 15, kind: 'agent', ...b }); k.box(r); return r; };
  const read = box({ x: 290, y: 20, w: 520, t: 'Read the other-family cell', s: 'project AGENTS.md, else ~/.claude/rules/orbit-models.md', kind: 'claude' });
  const empty = box({ x: 20, y: 170, w: 460, t: "Empty: the skill's own seat", s: 'reply says no other-family seat is configured', kind: 'claude' });
  const inherit = box({ x: 620, y: 170, w: 460, t: 'inherit: session-family seat', kind: 'claude' });
  const main = [
    { t: 'Check listed entries', s: "skip the lead's family; provider, model family, runtime" },
    { t: 'Keep at most 3 providers', s: 'list order; one entry per provider' },
    { t: 'Fill one seat, in order', s: 'next candidate on failure; never an unlisted one', kind: 'done' },
    { t: 'All fail: skip and say so', s: 'native only when the list ends with inherit', kind: 'fail' },
  ].map((b, i) => box({ x: 300, y: 320 + i * 120, w: 500, ...b }));
  k.arrow([[read.x + 60, read.bot + 6], [empty.cx, empty.y - 6]]);
  k.arrow([[read.r - 60, read.bot + 6], [inherit.cx, inherit.y - 6]]);
  k.text(read.x - 30, read.bot + 26, 'empty or no row', 17, k.c.muted, 'end');
  k.text(read.r + 30, read.bot + 26, 'inherit', 17, k.c.muted, 'start');
  k.arrow([[read.cx, read.bot + 6], [main[0].cx, main[0].y - 6]]);
  k.text(read.cx + 14, main[0].y - 24, 'a list', 17, k.c.muted, 'start');
  main.slice(1).forEach((b, i) => k.arrow([[main[i].cx, main[i].bot + 6], [b.cx, b.y - 6]]));
  k.text(main[3].cx + 14, main[3].y - 12, 'every candidate failed', 17, k.c.muted, 'start');
  return k;
}

const font = readFileSync(new URL('./Excalifont-Regular.woff2', import.meta.url)).toString('base64');
const scenes = { readme, docs, 'guide-arena': guideArena, 'guide-ship': guideShip, 'guide-autopilot': guideAutopilot, 'guide-stack': guideStack, 'guide-architect': guideArchitect, 'guide-models': guideModels, 't3-lead': t3Lead, 'provider-selection': providerSelection };
for (const [name, scene] of Object.entries(scenes)) {
  for (const t of ['light', 'dark']) writeFileSync(new URL(`./${name}-${t}.svg`, import.meta.url), scene(t).svg(font));
}
