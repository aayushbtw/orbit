import rough from 'roughjs';
import { readFileSync, writeFileSync } from 'node:fs';

const themes = {
  light: { ink: '#1e1e1e', muted: '#5c5f66', you: '#e5dbff', claude: '#d0ebff', agent: '#fff3bf', done: '#d3f9d8' },
  dark: { ink: '#e3e3e8', muted: '#a6a8ae', you: '#2e2550', claude: '#13304a', agent: '#3b3214', done: '#173d22' },
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
      text(b.x + b.w / 2, b.y + b.h / 2 - 2, b.t, 24);
      if (b.s) text(b.x + b.w / 2, b.y + b.h / 2 + 24, b.s, 17, c.muted);
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
  k.text(verify.cx + 14, verify.bot + 22, 'PASS', 17, k.c.muted, 'start');
  k.text(verify.x - 14, verify.cy + 6, 'FAIL: nothing lands', 18, k.c.muted, 'end');
  k.arrow([[land.x - 6, land.cy], [next.cx + 40, land.cy + 8], [next.cx, land.cy + 50], [next.cx, next.y - 6]]);
  k.text(W - 20, H - 24, 'dashed: only when it applies', 18, k.c.muted, 'end');
  return k;
}

const font = readFileSync(new URL('./Excalifont-Regular.woff2', import.meta.url)).toString('base64');
for (const [name, scene] of Object.entries({ readme, docs })) {
  for (const t of ['light', 'dark']) writeFileSync(new URL(`./${name}-${t}.svg`, import.meta.url), scene(t).svg(font));
}
