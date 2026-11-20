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
