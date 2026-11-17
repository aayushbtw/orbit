import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const HOMES = {
  claude: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  codex: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  grok: process.env.GROK_HOME ?? join(homedir(), '.grok'),
};

const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
export const readJsonl = (path) => (tryRead(path) ?? '').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const jsonlFiles = (dir, recursive = false) => existsSync(dir)
  ? readdirSync(dir, { recursive }).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  : [];
const childIdIn = (text) => { try { return [JSON.parse(text).childThreadId].filter((id) => typeof id === 'string'); } catch { return []; } };

const claude = {
  where: (worktreePath, { homes = HOMES } = {}) => join(homes.claude, 'projects', worktreePath.replace(/[^a-zA-Z0-9]/g, '-')),
  sessions: (worktreePath, ctx) => jsonlFiles(claude.where(worktreePath, ctx), true).map((f) => [f, readJsonl(f)]),
  lead(sessions, worktreePath, ctx) {
    const { message } = ctx;
    const [, command, args] = message.match(/^\/(\S+)\s*([\s\S]*)$/) ?? [];
    const opening = command ? `<command-message>${command}</command-message>\n<command-name>/${command}</command-name>\n<command-args>${args}</command-args>` : message;
    const [file] = sessions.find(([f, entries]) => {
      const first = entries.find((e) => e.type === 'user')?.message?.content;
      return dirname(f) === claude.where(worktreePath, ctx) && (first === message || first === opening);
    }) ?? [];
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

const codexItems = (entries) => entries.filter((e) => e.type === 'event_msg' && e.payload?.type === 'item_completed' && e.payload.item);
const spawnArgs = (entries) => new Map(entries
  .filter((e) => e.type === 'response_item' && e.payload?.type === 'function_call' && e.payload.name === 'spawn_agent')
  .flatMap(({ payload }) => {
    const args = parseJson(payload.arguments);
    return args ? [[payload.call_id, args]] : [];
  }));
const CODEX_CALLS = {
  McpToolCall: ({ server, tool, arguments: input }) => ({ name: `mcp__${server}__${tool}`, input }),
  CommandExecution: ({ command, cwd }) => ({ name: 'exec_command', input: { command, cwd } }),
  SubAgentActivity: ({ id, kind, agent_path, agent_thread_id, model, reasoning_effort }, spawns) => {
    if (kind !== 'started') return null;
    const { message: _, ...args } = spawns.get(id) ?? { join: 'missing' };
    return { name: 'spawn_agent', input: { ...args, agent_thread_id, agent_path, resolved_model: model, resolved_reasoning_effort: reasoning_effort } };
  },
  CollabAgentToolCall: ({ tool, receiver_thread_ids }) => ({ name: tool.endsWith('_agent') ? tool : `${tool}_agent`, input: { receiver_thread_ids } }),
  UserMessage: () => null,
  AgentMessage: () => null,
  Reasoning: () => null,
};

const codex = {
  where: (_, { homes = HOMES } = {}) => join(homes.codex, 'sessions'),
  sessions: (worktreePath, { homes = HOMES, since = 0 } = {}) => jsonlFiles(join(homes.codex, 'sessions'), true)
    .filter((f) => statSync(f).mtimeMs >= since)
    .map((f) => [f, readJsonl(f)])
    .filter(([, [meta]]) => meta?.type === 'session_meta' && meta.payload?.cwd === worktreePath),
  lead(sessions, _, ctx) {
    const [file] = sessions.toSorted(([, [a]], [, [b]]) => a.payload.timestamp.localeCompare(b.payload.timestamp))[0] ?? [];
    return file ? { file, ...codex.read(file, ctx, sessions) } : null;
  },
  read(file, ctx, sessions) {
    const entries = readJsonl(file);
    sessions ??= codex.sessions(entries[0]?.payload?.cwd, ctx);
    const leadId = entries[0].payload.id;
    const family = new Set([leadId]);
    for (let grew = true; grew;) {
      const next = sessions.filter(([, [meta]]) => family.has(meta.payload.parent_thread_id) && !family.has(meta.payload.id));
      for (const [, [meta]] of next) family.add(meta.payload.id);
      grew = next.length > 0;
    }
    const all = [entries, ...sessions.filter(([f, [meta]]) => f !== file && family.has(meta.payload.id)).map(([, sub]) => sub)];
    const spawns = spawnArgs(all.flat());
    const usage = entries.find((e) => e.type === 'token_usage_record')?.payload?.usage;
    return {
      firstTurnInputTokens: usage?.input_tokens ?? null,
      toolCalls: all.flatMap(codexItems).flatMap(({ payload: { thread_id, item } }) => {
        const call = (CODEX_CALLS[item.type] ?? (() => ({ name: item.type, input: item })))(item, spawns);
        return call ? [{ ...call, sidechain: thread_id !== leadId }] : [];
      }),
      pending: [],
    };
  },
  childIds: (sessions) => sessions
    .flatMap(([, entries]) => codexItems(entries))
    .filter((e) => e.payload.item.type === 'McpToolCall')
    .flatMap((e) => childIdIn(e.payload.item.result?.content?.[0]?.text)),
};

const grokQuery = (entries) => {
  const content = entries.find((e) => e.type === 'user' && 'prompt_index' in e)?.content;
  const text = Array.isArray(content) ? content.find((c) => c.type === 'text')?.text : content;
  return text?.match(/^<user_query>\n([\s\S]*?)\n<\/user_query>/)?.[1];
};
const grokCalls = (entries, sidechain) => entries
  .filter((e) => e.type === 'assistant')
  .flatMap((e) => e.tool_calls ?? [])
  .map((c) => ({ id: c.id, name: c.name, input: parseJson(c.arguments) ?? c.arguments, sidechain }));

const grok = {
  where: (worktreePath, { homes = HOMES } = {}) => join(homes.grok, 'sessions', encodeURIComponent(worktreePath)),
  sessions(worktreePath, ctx) {
    const dir = grok.where(worktreePath, ctx);
    return existsSync(dir)
      ? readdirSync(dir).map((id) => join(dir, id, 'chat_history.jsonl')).filter((f) => existsSync(f)).map((f) => [f, readJsonl(f)])
      : [];
  },
  lead(sessions, _, ctx) {
    const [file] = sessions.find(([, entries]) => grokQuery(entries) === ctx.message) ?? [];
    return file ? { file, ...grok.read(file) } : null;
  },
  read(file) {
    const root = dirname(dirname(file));
    const family = [basename(dirname(file))];
    for (const id of family) {
      const subagents = join(root, id, 'subagents');
      if (existsSync(subagents)) family.push(...readdirSync(subagents).filter((child) => !family.includes(child)));
    }
    const entries = readJsonl(file);
    const mainCalls = grokCalls(entries, false);
    const answered = new Set(entries.filter((e) => e.type === 'tool_result').map((e) => e.tool_call_id));
    const children = family.slice(1).flatMap((id) => grokCalls(readJsonl(join(root, id, 'chat_history.jsonl')), true));
    return {
      firstTurnInputTokens: null,
      toolCalls: [...mainCalls, ...children].map(({ id: _, ...call }) => call),
      pending: mainCalls.filter((c) => !answered.has(c.id)).map(({ name, input }) => ({ name, input })),
    };
  },
  childIds: (sessions) => sessions
    .flatMap(([, entries]) => entries)
    .filter((e) => e.type === 'tool_result')
    .flatMap((e) => childIdIn(typeof e.content === 'string' ? e.content : e.content?.[0]?.text)),
};

export const READERS = { claude, codex, grok };
export const kindOf = (providerInstanceId) => Object.keys(READERS).find((kind) => providerInstanceId?.toLowerCase().startsWith(kind));
export const readLead = (kind, file, ctx = {}) => READERS[kind].read(file, ctx);
