'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { collectTelemetry } = require('../telemetry');

async function fixture(t, relative, rows) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'route3-telemetry-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const file = path.join(home, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, rows.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n');
  return { home, file };
}
const codexPath = '.codex/sessions/2026/09/13/test.jsonl';
const claudePath = '.claude/projects/project/test.jsonl';
const counts = (input, output, cache = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cache, total_tokens: input + output });
const tokenEvent = (total, last, window = 100000) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: window } } });
const assistant = (id, input = 100, output = 20) => ({ type: 'assistant', sessionId: 'claude-test', cwd: '/test', message: { id, model: 'claude-test', role: 'assistant', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 }, content: [{ text: 'PRIVATE CONTENT MUST NOT APPEAR' }] } });

test('Codex uses latest cumulative snapshot, never sums snapshots or cached input twice', async t => {
  const { home } = await fixture(t, codexPath, [
    { type: 'session_meta', payload: { id: 'codex-test', cwd: '/test' } },
    { type: 'turn_context', payload: { model: 'gpt-test' } },
    tokenEvent(counts(90000, 10000, 20000), counts(80000, 1000, 20000)),
    tokenEvent(counts(100000, 12000, 30000), counts(10000, 2000, 10000))
  ]);
  const { sessions, summary } = await collectTelemetry({ home });
  assert.equal(sessions[0].inputTokens, 100000);
  assert.equal(sessions[0].totalTokens, 112000);
  assert.equal(sessions[0].contextTokens, 12000);
  assert.equal(sessions[0].contextPercent, 12);
  assert.equal(sessions[0].compact.level, 'healthy');
  assert.equal(sessions[0].measurement.usage, 'reported_cumulative');
  assert.equal(summary.totalTokens, 112000);
});

test('Claude deduplicates repeated content-block usage by message ID and includes caches once', async t => {
  const { home } = await fixture(t, claudePath, [assistant('a'), assistant('a'), assistant('a', 100, 25), assistant('b', 200, 40)]);
  const result = await collectTelemetry({ home }); const session = result.sessions[0];
  assert.equal(session.inputTokens, 460); // 180 + 280
  assert.equal(session.outputTokens, 65);
  assert.equal(session.cachedInputTokens, 100);
  assert.equal(session.cacheWriteInputTokens, 60);
  assert.equal(session.totalTokens, 525);
  assert.equal(session.contextTokens, 320);
  assert.equal(session.measurement.uniqueMessages, 2);
  assert.equal(session.measurement.duplicateEventsIgnored, 2);
  assert.equal(session.compact.level, 'unknown');
  assert.equal(JSON.stringify(result).includes('PRIVATE CONTENT'), false);
});

test('missing usage remains unknown, not zero; zero usage is a measured value', async t => {
  const { home, file } = await fixture(t, codexPath, [{ type: 'session_meta', payload: { id: 'empty' } }]);
  let result = await collectTelemetry({ home });
  assert.equal(result.sessions[0].totalTokens, null);
  assert.equal(result.summary.totalTokens, null);
  assert.equal(result.summary.unknownUsageSessions, 1);
  await fs.appendFile(file, JSON.stringify(tokenEvent(counts(0, 0), counts(0, 0))) + '\n');
  result = await collectTelemetry({ home });
  assert.equal(result.sessions[0].totalTokens, 0);
  assert.equal(result.summary.measuredSessions, 1);
  assert.equal(result.sessions[0].compact.level, 'healthy');
});

test('last usage alone does not pretend to be cumulative session spend', async t => {
  const { home } = await fixture(t, codexPath, [tokenEvent(null, counts(70000, 1000))]);
  const { sessions } = await collectTelemetry({ home });
  assert.equal(sessions[0].totalTokens, null);
  assert.equal(sessions[0].contextTokens, 71000);
  assert.equal(sessions[0].compact.level, 'watch');
});

test('malformed lines are isolated and partial Claude sums are labeled', async t => {
  const { home } = await fixture(t, claudePath, [assistant('a'), '{broken', assistant('b'), 'null']);
  const result = await collectTelemetry({ home });
  assert.equal(result.sessions[0].totalTokens, 400);
  assert.equal(result.sessions[0].measurement.usage, 'partial_messages');
  assert.equal(result.sessions[0].measurement.skippedLines, 1);
  assert.equal(result.warnings.length, 1);
});

test('tail and file count bounds restrict processing and expose incomplete coverage', async t => {
  const { home, file } = await fixture(t, claudePath, [assistant('early'), { padding: 'x'.repeat(5000) }, assistant('late')]);
  const second = path.join(path.dirname(file), 'second.jsonl');
  await fs.writeFile(second, JSON.stringify(assistant('other')) + '\n');
  await fs.utimes(file, new Date(), new Date(Date.now() + 1000));
  const result = await collectTelemetry({ home, limit: 1, bounds: { maxBytes: 700, headBytes: 32 } });
  assert.equal(result.summary.processedFiles, 1);
  assert.equal(result.sessions[0].measurement.coverage, 'tail');
  assert.equal(result.sessions[0].measurement.usage, 'partial_messages');
  assert.equal(result.sessions[0].totalTokens, 200);
  assert.ok(result.warnings.some(s => s.includes('bounded tail')));
});

test('oversized records do not prevent parsing subsequent usage', async t => {
  const { home } = await fixture(t, codexPath, [{ padding: 'x'.repeat(1000) }, tokenEvent(counts(100, 1), counts(100, 1))]);
  const result = await collectTelemetry({ home, bounds: { maxLineBytes: 500 } });
  assert.equal(result.sessions[0].totalTokens, 101);
  assert.equal(result.sessions[0].measurement.skippedLines, 1);
});

test('compaction clears stale context proxy until the next measured request', async t => {
  const { home } = await fixture(t, codexPath, [tokenEvent(counts(90000, 1000), counts(90000, 1000)), { type: 'compacted', payload: {} }]);
  const { sessions } = await collectTelemetry({ home });
  assert.equal(sessions[0].totalTokens, 91000);
  assert.equal(sessions[0].contextTokens, null);
  assert.equal(sessions[0].compact.level, 'unknown');
  assert.equal(sessions[0].measurement.context, 'awaiting_usage_after_compaction');
});

test('configurable thresholds use last request occupancy and validate order', async t => {
  const { home } = await fixture(t, codexPath, [tokenEvent(counts(1000000, 10000), counts(80000, 0))]);
  const first = await collectTelemetry({ home });
  assert.equal(first.sessions[0].compact.level, 'recommended');
  const second = await collectTelemetry({ home, thresholds: { watch: 20, recommended: 40, urgent: 60 } });
  assert.equal(second.sessions[0].compact.level, 'urgent');
  // Mutation of returned objects must not corrupt the cached parse.
  first.sessions[0].totalTokens = 1;
  assert.equal(second.sessions[0].totalTokens, 1010000);
  await assert.rejects(collectTelemetry({ home, thresholds: { watch: 90, recommended: 10 } }), /thresholds/);
});

test('OpenClaw index context does not invent cumulative spend or freshness', async t => {
  const { home, file } = await fixture(t, '.openclaw/agents/main/sessions/sessions.json', [{
    'agent:main': { sessionId: 'openclaw-test', model: 'model-test', totalTokens: 85000, contextTokens: 100000, totalTokensFresh: true }
  }]);
  let result = await collectTelemetry({ home });
  assert.equal(result.sessions[0].contextPercent, 85);
  assert.equal(result.sessions[0].totalTokens, null);
  assert.equal(result.sessions[0].compact.level, 'recommended');
  await fs.writeFile(file, JSON.stringify({ main: { sessionId: 'openclaw-test', totalTokens: 85000, contextTokens: 100000 } }));
  result = await collectTelemetry({ home });
  assert.equal(result.sessions[0].contextTokens, null);
  assert.equal(result.sessions[0].compact.level, 'unknown');
});

test('OpenClaw message usage is summed separately from last context', async t => {
  const { home } = await fixture(t, '.openclaw/agents/main/sessions/test.jsonl', [
    { type: 'session', id: 'openclaw-test', cwd: '/test' },
    { type: 'message', id: 'a', message: { role: 'assistant', model: 'test', usage: { input: 100, output: 10, cacheRead: 50, cacheWrite: 20, totalTokens: 180 } } },
    { type: 'message', id: 'b', message: { role: 'assistant', model: 'test', usage: { input: 200, output: 20, cacheRead: 100, cacheWrite: 40, totalTokens: 360 } } }
  ]);
  const { sessions } = await collectTelemetry({ home });
  assert.equal(sessions[0].inputTokens, 510);
  assert.equal(sessions[0].totalTokens, 540);
  assert.equal(sessions[0].contextTokens, 360);
});

test('empty directories produce unknown aggregate and no invented sessions', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'route3-empty-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const result = await collectTelemetry({ home });
  assert.deepEqual(result.sessions, []);
  assert.equal(result.summary.totalTokens, null);
  assert.deepEqual(result.warnings, []);
});

test('Claude sibling agents and their parent remain separate sessions even with identical cwd and sessionId', async t => {
  const { home, file } = await fixture(t, claudePath, [assistant('parent')]);
  const subagents = path.join(path.dirname(file), 'claude-test', 'subagents');
  await fs.mkdir(subagents, { recursive: true });
  await fs.writeFile(path.join(subagents, 'agent-one.jsonl'), JSON.stringify({ ...assistant('child-one'), agentId: 'one', isSidechain: true }) + '\n');
  await fs.writeFile(path.join(subagents, 'agent-two.jsonl'), JSON.stringify({ ...assistant('child-two'), agentId: 'two', isSidechain: true }) + '\n');
  const result = await collectTelemetry({ home });
  assert.equal(result.sessions.length, 3);
  assert.equal(result.summary.totalTokens, 600);
  assert.deepEqual(result.sessions.map(s => s.id).sort(), ['claude-test', 'claude-test:agent:one', 'claude-test:agent:two']);
});
