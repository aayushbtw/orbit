import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
export const readJsonl = (path) => (tryRead(path) ?? '').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const jsonlFiles = (dir, recursive = false) => existsSync(dir)
  ? readdirSync(dir, { recursive }).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  : [];
const childIdIn = (text) => { try { return [JSON.parse(text).childThreadId].filter((id) => typeof id === 'string'); } catch { return []; } };

const claudeStart = (entries) => Date.parse(entries.find((e) => e.type === 'user')?.timestamp);

export const claude = {
  where: (worktreePath, { home = CLAUDE_HOME } = {}) => join(home, 'projects', worktreePath.replace(/[^a-zA-Z0-9]/g, '-')),
  // A thread on the project root shares its folder with earlier lanes, and Claude Code still appends to their files, so a file counts only when its first user entry is from after the lane started.
  sessions: (worktreePath, ctx = {}) => jsonlFiles(claude.where(worktreePath, ctx), true)
    .filter((f) => statSync(f).mtimeMs >= (ctx.since ?? 0))
    .map((f) => [f, readJsonl(f)])
    .filter(([, entries]) => claudeStart(entries) >= (ctx.since ?? 0)),
  lead(sessions, worktreePath, ctx) {
    const { message } = ctx;
    const [, command, args] = message.match(/^\/(\S+)\s*([\s\S]*)$/) ?? [];
    const opening = command ? `<command-message>${command}</command-message>\n<command-name>/${command}</command-name>\n<command-args>${args}</command-args>` : message;
    const [file] = sessions.filter(([f, entries]) => {
      const first = entries.find((e) => e.type === 'user')?.message?.content;
      return dirname(f) === claude.where(worktreePath, ctx) && (first === message || first === opening);
    }).toSorted(([, a], [, b]) => claudeStart(b) - claudeStart(a))[0] ?? [];
    return file ? { file, ...claude.read(file) } : null;
  },
  read(file) {
    const entries = readJsonl(file);
    const usage = entries.find((e) => e.type === 'assistant' && e.message?.usage)?.message.usage;
    const seen = new Set();
    const toolUses = (list, sidechain) => list
      .filter((e) => e.type === 'assistant' && Array.isArray(e.message?.content))
      .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'))
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .map((c) => ({ id: c.id, name: c.name, input: c.input, sidechain }));
    const mainCalls = toolUses(entries, false);
    const answered = new Set(entries
      .filter((e) => e.type === 'user' && Array.isArray(e.message?.content))
      .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_result').map((c) => c.tool_use_id)));
    const subagents = jsonlFiles(join(file.slice(0, -'.jsonl'.length), 'subagents')).map(readJsonl);
    return {
      firstTurnInputTokens: usage ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : null,
      toolCalls: [...mainCalls, ...subagents.flatMap((sub) => toolUses(sub, true))].map(({ id: _, ...call }) => call),
      pending: mainCalls.filter((c) => !answered.has(c.id)).map(({ name, input }) => ({ name, input })),
    };
  },
  childIds: (sessions) => sessions
    .flatMap(([, entries]) => entries)
    .filter((e) => e.type === 'user' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_result'))
    .flatMap((c) => childIdIn(typeof c.content === 'string' ? c.content : c.content?.[0]?.text)),
};

export const isClaude = (providerInstanceId) => providerInstanceId?.toLowerCase().startsWith('claude') === true;

const PAGE_LIMIT = 100;
const MAX_CHARS = 20_000;
const MAX_PAGES = 1_000;
const MAX_TEXT_READS = 50;
const TOOL_ITEMS = new Set(['command_execution', 'dynamic_tool', 'mcp_tool_call']);
const DONE = new Set(['completed', 'failed', 'declined', 'cancelled', 'canceled', 'error', 'interrupted']);
const SHELL = /^(?:\S*\/)?(?:ba|z)?sh\s+-\w*c\s+(['"])([\s\S]*)\1$/;

const unquote = (quote, body) => quote === "'" ? body.replaceAll(`'\\''`, "'") : body.replace(/\\(["\\$`])/g, '$1');

// Codex wraps each command in `/bin/zsh -lc "<cmd>"`, so the grader sees the inner command as a Claude Bash call would.
export function unwrapShell(command) {
  const match = command.trim().match(SHELL);
  return match ? unquote(match[1], match[2]) : command.trim();
}

// A quoted -lc body can span lines, so the command runs to the first line that closes the quote.
export function commandOf(text) {
  const lines = text.replace(/^\$ /, '').split('\n');
  for (let end = 1; end <= lines.length; end += 1) {
    const candidate = lines.slice(0, end).join('\n');
    if (SHELL.test(candidate.trim())) return unwrapShell(candidate);
  }
  return lines[0].trim();
}

export const t3ToolName = (name) => name.replace(/^(?:mcp_{1,2})?t3-code(?:\.|__|_|\/)(.+)$/, 'mcp__t3-code__$1');

const parseInput = (value) => {
  if (typeof value !== 'string') return value ?? {};
  try { return JSON.parse(value); } catch { return value; }
};

export function activityCall(item, sidechain) {
  if (!TOOL_ITEMS.has(item?.type) || typeof item.text !== 'string') return null;
  if (item.type === 'command_execution') {
    return item.text.startsWith('$ ') ? { name: 'Bash', input: { command: commandOf(item.text) }, sidechain } : null;
  }
  let body;
  try { body = JSON.parse(item.text); } catch { return null; }
  const raw = body?.toolName ?? body?.name ?? (body?.server && body?.tool ? `${body.server}.${body.tool}` : null);
  if (typeof raw !== 'string' || !raw) return null;
  return { name: t3ToolName(raw), input: parseInput(body.input ?? body.arguments ?? body.args), sidechain };
}

const itemOf = (reply, itemId) => reply?.item ?? reply?.items?.find((i) => i.itemId === itemId) ?? reply?.items?.[0] ?? reply;

async function fullText(tool, threadId, item) {
  let { text, textTruncated, nextTextOffset } = item;
  for (let reads = 0; textTruncated === true && nextTextOffset != null && reads < MAX_TEXT_READS; reads += 1) {
    const next = itemOf(await tool('t3_thread_read', { threadId, itemId: item.itemId, textOffset: nextTextOffset, maxCharsPerItem: MAX_CHARS }), item.itemId);
    if (typeof next?.text !== 'string' || !next.text) break;
    text += next.text;
    ({ textTruncated, nextTextOffset } = next);
  }
  return text;
}

// `tool(name, args)` calls one T3 MCP tool and resolves to its structured result.
export async function readT3Activity(tool, threadId, sidechain = false) {
  const calls = [];
  const pending = [];
  let afterPosition = -1;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await tool('t3_thread_read', { threadId, view: 'activity', afterPosition, limit: PAGE_LIMIT, maxCharsPerItem: MAX_CHARS });
    for (const item of page.items ?? []) {
      if (!TOOL_ITEMS.has(item?.type)) continue;
      const text = item.textTruncated ? await fullText(tool, threadId, item) : item.text;
      const call = activityCall({ ...item, text }, sidechain);
      if (!call) continue;
      calls.push(call);
      if (item.status && !DONE.has(item.status)) pending.push({ name: call.name, input: call.input });
    }
    if (!page.hasMore || page.nextPosition == null || page.nextPosition === afterPosition) break;
    afterPosition = page.nextPosition;
  }
  return { calls, pending };
}

// The lead's calls come first with sidechain false, then each descendant thread's with sidechain true.
export async function readT3ActivityTree(tool, leadThreadId, threads = []) {
  const lead = await readT3Activity(tool, leadThreadId, false);
  const children = [];
  for (const { threadId } of threads.filter((t) => t.threadId !== leadThreadId && t.parentThreadId)) {
    children.push(...(await readT3Activity(tool, threadId, true)).calls);
  }
  return { toolCalls: [...lead.calls, ...children], pending: lead.pending };
}

const requestIds = (reply) => [reply?.requests, reply?.pendingRequests, reply?.items, reply?.ids, reply?.requestIds]
  .find(Array.isArray)
  ?.map((r) => typeof r === 'string' ? r : r?.requestId ?? r?.id)
  .filter(Boolean) ?? [];

// t3_pending_request lists user questions only, never approvals, so each id is the lead's own question.
export async function pendingQuestions(tool, threadId, pending) {
  if (pending.length) return pending;
  const ids = requestIds(await tool('t3_pending_request', { action: 'list', threadId }));
  return ids.length ? ids.map((requestId) => ({ name: 'request_user_input', input: { requestId } })) : null;
}
