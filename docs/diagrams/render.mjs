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
  const W = 1210, H = 440;
  const k = canvas(theme, W, H);
  const lanes = [['You', 20, 140], ['Claude', 140, 260], ['Subagents', 260, 440]];
  for (const [name, y0, y1] of lanes) k.text(16, (y0 + y1) / 2 + 8 - (name === 'Subagents' ? 20 : 0), name, 24, k.c.ink, 'start');
  k.line(10, 140, W - 10, 140);
  k.line(10, 260, W - 10, 260);

  const laneY = { you: 38, claude: 158, agent: 278 };
  const seq = [
    ['you', '/orbit:start', 'you name the goal'],
    ['claude', 'Pick the flow', 'steps + worktree'],
    ['agent', 'Write a unit', 'poteto-agent'],
    ['claude', 'Review it', 'reads and runs it'],
    ['agent', 'Commit', 'gitops'],
    ['claude', 'Clean up', 'deslop, no-comments'],
    ['agent', 'Verify', 'fresh verifier'],
    ['you', 'Next: line', 'after it lands'],
  ].map(([lane, t, s], i) => B({ x: 135 + i * 125, y: laneY[lane], w: 180, h: 84, t, s, kind: i === 7 ? 'done' : lane }));
  seq.forEach((b) => k.box(b));
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1];
    k.arrow(b.y > a.y ? [[a.x + 150, a.bot + 6], [b.x + 32, b.y - 6]] : [[a.x + 150, a.y - 6], [b.x + 32, b.bot + 6]]);
  }
  const [w, , c] = [seq[2], seq[3], seq[4]];
  k.arrow([[c.cx, c.bot + 6], [(c.cx + w.cx) / 2, c.bot + 42], [w.cx + 20, w.bot + 6]]);
  k.text((c.cx + w.cx) / 2, c.bot + 66, 'next unit', 18, k.c.muted);
  k.text(seq[6].x + 158, 214, 'PASS: lands', 18, k.c.muted, 'start');
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
  const plan = box('agent', 3, 'Check the plan', 'advisor, if > 3 files', { optional: true });
  k.frame(205, rowY(4) - 10, 730, 2 * 108 + 100, 'repeats for each unit');
  const write = box('agent', 4, 'Write a unit', 'poteto-agent');
  const review = box('claude', 5, 'Review it', 'reads and runs it');
  const commit = box('agent', 6, 'Commit', 'gitops');
  const inter = box('agent', 7, 'Interrogate', 'contested design only', { optional: true });
  const deslop = box('claude', 8, 'Deslop', 'cut AI slop');
  const sicko = box('agent', 8, 'Strip comments', 'comment-sicko');
  const pr = box('agent', 9, 'PR or branch', 'gitops');
  const stop = box('you', 9, 'Next:', '/orbit:ship', { kind: 'done', optional: true });
  const baby = box('claude', 10, 'Babysit', 'Land pr: to merge-ready', { optional: true });
  const verify = box('agent', 11, 'Verify', 'fresh verifier');
  const fail = box('claude', 11, 'Nothing lands', 'FAIL, with a repro', { kind: 'fail' });
  const land = box('agent', 12, 'Land', 'gitops merges or pushes');
  const next = box('you', 13, 'Next: line', 'what to do next', { kind: 'done' });

  down(start, pick);
  k.arrow([[pick.x - 6, pick.cy], [answer.r + 6, answer.cy]], true);
  k.arrow([[pick.cx, pick.bot + 6], [wt.cx, wt.y - 6]]);
  down(wt, plan, true);
  k.arrow([[plan.cx, plan.bot + 6], [write.cx, write.y - 6]]);
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
  box({ x: 130, y: 382, w: 260, t: 'Judge', s: 'read-only, scores all', kind: 'agent' });
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
  const W = 1125, H = 400;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ h: 84, ...b }); k.box(r); return r; };
  const opening = box({ x: 20, y: 115, w: 210, t: 'Opening a PR', s: 'deslop, no-comments', kind: 'claude' });
  const pr = box({ x: 290, y: 25, w: 220, t: 'Open a PR', s: 'ready, not a draft', kind: 'claude' });
  const branch = box({ x: 290, y: 205, w: 220, t: 'Keep the branch', s: 'local, unpushed', kind: 'claude' });
  const verifier = box({ x: 650, y: 115, w: 215, t: 'Verifier', s: 'fresh, runs it like a user', kind: 'agent' });
  const lands = box({ x: 910, y: 25, w: 200, t: 'Lands', s: 'PASS or PASS+NOTES', ss: 16, kind: 'done' });
  const waits = box({ x: 910, y: 205, w: 200, t: 'Nothing lands', s: 'FAIL, with a repro', ss: 16, kind: 'fail' });
  k.link(opening, pr);
  k.link(opening, branch);
  k.text(222, 100, 'Land pr', 17, k.c.muted, 'end');
  k.text(222, 228, 'Land main', 17, k.c.muted, 'end');
  k.link(pr, verifier);
  k.link(branch, verifier);
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
  const root = box({ x: 240, y: 160, w: 190, t: 'Root', s: 'writes no code', kind: 'claude' });
  const owners = ['A', 'B', 'C'].map((n, i) => box({ x: 475, y: 30 + i * 130, w: 210, t: `Owner ${n}`, s: 'flow, PR, babysit', kind: 'agent' }));
  const ver = box({ x: 730, y: 30, w: 170, h: 344, t: 'Verifiers', kind: 'agent' });
  ['a fresh swarm', 'at each', 'code-ready head'].forEach((l, i) => k.text(ver.cx, ver.cy + 34 + i * 22, l, 17, k.c.muted));
  const full = box({ x: 945, y: 70, w: 200, t: 'autopilot-full', s: 'a fresh owner merges', kind: 'done' });
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
  k.text(440, c.bot + 84, '/loop 1h reads each trail', 17, k.c.muted);
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
  const W = 1100, H = 480;
  const k = canvas(theme, W, H);
  const box = (b) => { const r = B({ y: 100, w: 210, h: 84, ...b }); k.box(r); return r; };
  const ground = box({ x: 25, t: 'Ground', s: 'how + why', kind: 'claude' });
  const sketch = box({ x: 295, t: 'Sketch', s: 'arena, 2 runners', kind: 'claude' });
  const agree = box({ x: 565, t: 'Agree', s: 'checkpoint if asked', kind: 'you', optional: true });
  const impl = box({ x: 835, t: 'Implement', s: 'fill in the bodies', kind: 'claude' });
  const scrap = box({ x: 835, y: 310, t: 'Scrap', s: 'throw the sketch out', kind: 'fail' });
  k.link(ground, sketch);
  k.link(sketch, agree);
  k.link(agree, impl);
  k.arrow([[sketch.cx + 40, sketch.y - 6], [sketch.r + 30, 58], [impl.x - 30, 58], [impl.cx - 40, impl.y - 6]], true);
  k.text(agree.cx, 40, 'Agree is off by default', 17, k.c.muted);
  k.arrow([[impl.cx, impl.bot + 6], [scrap.cx, scrap.y - 6]], true);
  k.text(impl.cx - 14, 256, 'a pattern of friction', 17, k.c.muted, 'end');
  k.arrow([[scrap.x - 6, scrap.cy], [620, 400], [420, 360], [sketch.cx, sketch.bot + 6]]);
  k.text(560, 432, 'smaller sketch', 17, k.c.muted);
  return k;
}

function guideModels(theme) {
  const W = 1060, H = 560;
  const k = canvas(theme, W, H);
  const ask = (y, t, s) => { const r = B({ x: 30, y, w: 420, h: 84, t, s, kind: 'claude' }); k.box(r); return r; };
  const pick = (y, t, s) => { const r = B({ x: 620, y, w: 410, h: 84, t, s, kind: 'agent' }); k.box(r); return r; };
  const qs = [
    ask(30, 'Step picks its own?', 'model or effort, such as recall'),
    ask(170, 'Spawn names a role?', 'gitops, verifier, advisor, judgment, code'),
    ask(310, 'A work type fits?', 'any other poteto-agent unit'),
  ];
  const picks = [
    pick(30, 'Keep it', "recall's haiku, live lanes at high"),
    pick(170, "The role's row", 'an empty cell keeps the default'),
    pick(310, "The work type's row", 'after <n> failed tries steps up'),
  ];
  const tier = B({ x: 30, y: 450, w: 420, h: 84, t: 'Tier by difficulty', s: 'hardest or prose: judgment, the rest: code', kind: 'agent' });
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

const font = readFileSync(new URL('./Excalifont-Regular.woff2', import.meta.url)).toString('base64');
const scenes = { readme, docs, 'guide-arena': guideArena, 'guide-ship': guideShip, 'guide-autopilot': guideAutopilot, 'guide-stack': guideStack, 'guide-architect': guideArchitect, 'guide-models': guideModels };
for (const [name, scene] of Object.entries(scenes)) {
  for (const t of ['light', 'dark']) writeFileSync(new URL(`./${name}-${t}.svg`, import.meta.url), scene(t).svg(font));
}
