import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const bundleMarker = (sha, id) => `orbit-lane-rev-${sha.slice(0, 12)}-${id}`;

export const LEAD_RULES_FILES = ['rules.md', join('skills', 'rules', 'SKILL.md')];

export function stampBundleMarker(pluginDir, marker) {
  for (const file of LEAD_RULES_FILES) appendFileSync(join(pluginDir, file), `\n<!-- ${marker} -->\n`);
}

const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

export function verifyRevisionEvidence({ marker, session, reply, messages }) {
  if (session && tryRead(session)?.includes(marker)) return { proven: true, evidence: 'marker observed in lead session' };
  if ([reply, ...(messages ?? []).map((m) => m?.text)].some((text) => typeof text === 'string' && text.includes(marker))) {
    return { proven: true, evidence: 'marker observed in lead messages' };
  }
  return { proven: false, evidence: session ? 'marker absent from lead session' : 'no lead session file found to verify bundle marker' };
}

export function checkRevisionProof(lane) {
  const { revision } = lane;
  if (!revision) return 'no revision record';
  if (revision.proven !== true) return revision.evidence ?? 'revision not proven';
  if (typeof revision.marker !== 'string' || !revision.marker) return 'no bundle marker';
  if (revision.requestedSha !== lane.head?.sha) return `requestedSha ${revision.requestedSha} differs from head ${lane.head?.sha ?? null}`;
  return null;
}
