import { expectRejection } from '../support/expectRejection';
import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';
import { clearQueryLog, getResponseTimes, getUsageForMonth, logQuery } from '@/data/telemetryRepo';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

/** Writes a row stamped in a given month, bypassing `logQuery`'s "now". */
async function logAt(month: string, fields: Record<string, unknown> = {}) {
  await db.run(
    `INSERT INTO query_log (at, route, tokens_in, tokens_out, model_alias, latency_ms, error_code, outcome, tool_calls)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      `${month}-15T10:00:00.000Z`,
      (fields.route as string) ?? 'agent',
      (fields.tokensIn as number) ?? null,
      (fields.tokensOut as number) ?? null,
      (fields.modelAlias as string) ?? null,
      (fields.latencyMs as number) ?? null,
      (fields.errorCode as string) ?? null,
      (fields.outcome as string) ?? 'ok',
      (fields.toolCalls as string) ?? null,
    ]
  );
}

describe('logQuery (§15.3)', () => {
  it('records counters and the tools that ran', async () => {
    await logQuery(db, {
      route: 'agent',
      outcome: 'ok',
      tokensIn: 3764,
      tokensOut: 92,
      modelAlias: 'gemini-3.6-flash',
      latencyMs: 6026,
      toolCalls: ['parse_receipt'],
    });

    const [row] = await db.all<Record<string, unknown>>('SELECT * FROM query_log');
    expect(row.tokens_in).toBe(3764);
    expect(row.model_alias).toBe('gemini-3.6-flash');
    expect(row.tool_calls).toBe('["parse_receipt"]');
    expect(row.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('stores no content — the schema has nowhere to put any', async () => {
    await logQuery(db, { route: 'agent', outcome: 'ok', toolCalls: ['parse_receipt'] });
    const [row] = await db.all<Record<string, unknown>>('SELECT * FROM query_log');

    // §15.3: diagnostic, not a transcript. Every column is a counter, a code,
    // or a tool name.
    expect(Object.keys(row).sort()).toEqual(
      // `first_token_ms` is a duration (§6.8), which is a counter like the
      // rest. Adding a column here should be a deliberate act, which is why
      // this list is spelled out rather than derived.
      ['at', 'error_code', 'first_token_ms', 'id', 'latency_ms', 'model_alias',
       'outcome', 'route', 'tokens_in', 'tokens_out', 'tool_calls'].sort()
    );
  });

  it('rejects an outcome outside the vocabulary (§4.7)', async () => {
    await expectRejection(() => db.run(
        `INSERT INTO query_log (at, route, outcome) VALUES ('2026-08-01T00:00:00Z', 'agent', 'maybe')`
      ));
  });
});

describe('getUsageForMonth', () => {
  it('sums a month and ignores the others', async () => {
    await logAt('2026-08', { tokensIn: 100, tokensOut: 10, toolCalls: '["parse_receipt"]' });
    await logAt('2026-08', { tokensIn: 200, tokensOut: 20, toolCalls: '["parse_receipt"]' });
    await logAt('2026-07', { tokensIn: 999, tokensOut: 99 });

    const usage = await getUsageForMonth(db, '2026-08');
    expect(usage.requests).toBe(2);
    expect(usage.tokensIn).toBe(300);
    expect(usage.tokensOut).toBe(30);
  });

  it('counts receipt reads separately from other turns', async () => {
    await logAt('2026-08', { toolCalls: '["parse_receipt"]' });
    await logAt('2026-08', { toolCalls: '["query_ledger"]' });
    await logAt('2026-08');

    const usage = await getUsageForMonth(db, '2026-08');
    expect(usage.requests).toBe(3);
    expect(usage.receiptReads).toBe(1);
  });

  it('counts failures, so usage does not flatter the app', async () => {
    await logAt('2026-08', { outcome: 'ok' });
    await logAt('2026-08', { outcome: 'error', errorCode: 'TransportRequestError' });

    const usage = await getUsageForMonth(db, '2026-08');
    expect(usage.requests).toBe(2);
    expect(usage.failures).toBe(1);
  });

  it('reports a median latency, which survives one slow outlier', async () => {
    for (const ms of [1000, 1200, 1100, 30000]) await logAt('2026-08', { latencyMs: ms });

    const usage = await getUsageForMonth(db, '2026-08');
    // A mean would read ~8.3s; the median describes a typical wait.
    expect(usage.medianLatencyMs).toBe(1150);
  });

  it('returns zeros and a null latency for a month with nothing in it', async () => {
    const usage = await getUsageForMonth(db, '2026-08');
    expect(usage).toMatchObject({
      requests: 0,
      receiptReads: 0,
      tokensIn: 0,
      tokensOut: 0,
      failures: 0,
      medianLatencyMs: null,
    });
  });

  it('groups by the UTC instant, not a local calendar date', async () => {
    // `at` is an ISO-8601 UTC timestamp (§4.3) — this counts when the request
    // was spent, and billing periods belong to the provider.
    await logAt('2026-08');
    expect((await getUsageForMonth(db, '2026-08')).requests).toBe(1);
    expect((await getUsageForMonth(db, '2026-09')).requests).toBe(0);
  });
});

describe('clearQueryLog', () => {
  it('empties the log and reports how many rows went', async () => {
    await logAt('2026-08');
    await logAt('2026-08');
    expect(await clearQueryLog(db)).toBe(2);
    expect(await db.all('SELECT * FROM query_log')).toHaveLength(0);
  });
});

/**
 * The two figures §6.8 asks for (§6.8, §15.3).
 *
 * What needs pinning is that they measure different quantities. A fastpath
 * is timed end to end; an agent turn is timed to its *first token*, because a
 * turn that calls two tools and writes at length can run fifteen seconds and
 * still feel immediate. Reporting the total would flatter a slow app and
 * punish a responsive one.
 */
describe('response times (§6.8)', () => {
  const log = (route: string, latencyMs: number | null, firstTokenMs: number | null) =>
    db.run(
      `INSERT INTO query_log (at, route, latency_ms, first_token_ms, outcome)
       VALUES ('2026-09-28T10:00:00.000Z', ?, ?, ?, 'ok')`,
      [route, latencyMs, firstTokenMs]
    );

  it('has nothing to report from an unused app', async () => {
    expect(await getResponseTimes(db)).toEqual({
      fastpathCount: 0,
      agentCount: 0,
      fastpathP95Ms: null,
      agentFirstTokenP50Ms: null,
      agentFirstTokenP95Ms: null,
    });
  });

  it('takes the fastpath p95 by nearest rank', async () => {
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 900]) await log('fastpath', ms, null);

    const times = await getResponseTimes(db);

    expect(times.fastpathCount).toBe(10);
    // Ceil(0.95 × 10) = 10th of ten: the slow one, which is the point of p95.
    expect(times.fastpathP95Ms).toBe(900);
  });

  it('times an agent turn to its first token, not to its end', async () => {
    await log('agent', 15_000, 800);

    const times = await getResponseTimes(db);

    expect(times.agentFirstTokenP50Ms).toBe(800);
  });

  /** Null is "no stream happened", and counting it as zero would flatter. */
  it('ignores turns that never produced a first token', async () => {
    await log('agent', 4000, null);
    await log('agent', 4000, 2000);

    const times = await getResponseTimes(db);

    expect(times.agentCount).toBe(1);
    expect(times.agentFirstTokenP50Ms).toBe(2000);
  });

  it('keeps the two routes apart', async () => {
    await log('fastpath', 40, null);
    await log('agent', 9000, 3000);

    const times = await getResponseTimes(db);

    expect(times.fastpathP95Ms).toBe(40);
    expect(times.agentFirstTokenP50Ms).toBe(3000);
  });

  it('reports a single sample as its own percentile', async () => {
    await log('fastpath', 42, null);

    expect((await getResponseTimes(db)).fastpathP95Ms).toBe(42);
  });
});
