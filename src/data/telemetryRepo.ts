/**
 * Local usage telemetry — spec §15.3.
 *
 * **Local-only, and content-free.** `query_log` records counters: route,
 * latency, token counts, model, outcome, and a JSON summary of which tools ran.
 * No question text, no merchant, no amounts. It is diagnostic, not a
 * transcript, and §15.3 requires that any sharing be explicit opt-in and
 * aggregate — so nothing here leaves the device.
 *
 * ## Why a receipt parse is logged as `route='agent'`
 *
 * The schema constrains `route` to `('fastpath','agent')`, and a receipt parse
 * is strictly neither. But §5.1 calls `parse_receipt` a **tool**, and
 * `tool_calls` exists precisely to record which tools ran — so a parse is an
 * agent-route turn whose tool was `parse_receipt`. That keeps parses
 * distinguishable from question-answering turns without a migration whose only
 * purpose is widening a CHECK, which in SQLite means rebuilding the table.
 *
 * If Week 7 finds the distinction needs to be first-class, migration 002 can
 * add a `'parse'` route then, with real usage to justify it.
 */

import { monthOf, nowUtc, todayLocalDate } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import type { QueryOutcome, QueryRoute } from '@/types/vocabulary';

export interface QueryLogEntry {
  route: QueryRoute;
  outcome: QueryOutcome;
  tokensIn?: number | null;
  tokensOut?: number | null;
  modelAlias?: string | null;
  latencyMs?: number | null;
  /** Milliseconds to the model's first streamed character (§6.8), or null. */
  firstTokenMs?: number | null;
  /** Hub error code (§13.6) when one applies. */
  errorCode?: string | null;
  /** Names only — §15.3 is explicit that no values are recorded. */
  toolCalls?: string[];
}

export async function logQuery(db: SqlDriver, entry: QueryLogEntry): Promise<void> {
  await db.run(
    `INSERT INTO query_log
       (at, route, tokens_in, tokens_out, model_alias, latency_ms, first_token_ms,
        error_code, outcome, tool_calls)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      nowUtc(),
      entry.route,
      entry.tokensIn ?? null,
      entry.tokensOut ?? null,
      entry.modelAlias ?? null,
      entry.latencyMs ?? null,
      entry.firstTokenMs ?? null,
      entry.errorCode ?? null,
      entry.outcome,
      entry.toolCalls?.length ? JSON.stringify(entry.toolCalls) : null,
    ]
  );
}

export interface UsageSummary {
  /** `'YYYY-MM'`. */
  month: string;
  requests: number;
  /** How many of those were receipt reads. */
  receiptReads: number;
  tokensIn: number;
  tokensOut: number;
  /** Requests that returned nothing useful (§15.3's `error`). */
  failures: number;
  /** Median round-trip, which reads truer than a mean over a handful of calls. */
  medianLatencyMs: number | null;
}

/**
 * Usage for a calendar month, for the Settings screen.
 *
 * `at` is an ISO-8601 UTC instant (§4.3), so the month is taken from the
 * timestamp rather than a local calendar date — this counts what was spent,
 * not what was purchased, and billing periods are the provider's.
 */
export async function getUsageForMonth(
  db: SqlDriver,
  month: string = monthOf(todayLocalDate())
): Promise<UsageSummary> {
  const totals = await db.get<{
    requests: number;
    tokens_in: number | null;
    tokens_out: number | null;
    failures: number;
    receipt_reads: number;
  }>(
    `SELECT COUNT(*) AS requests,
            SUM(tokens_in) AS tokens_in,
            SUM(tokens_out) AS tokens_out,
            SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS failures,
            SUM(CASE WHEN tool_calls LIKE '%parse_receipt%' THEN 1 ELSE 0 END) AS receipt_reads
       FROM query_log
      WHERE substr(at, 1, 7) = ?`,
    [month]
  );

  const latencies = await db.all<{ latency_ms: number }>(
    `SELECT latency_ms FROM query_log
      WHERE substr(at, 1, 7) = ? AND latency_ms IS NOT NULL
      ORDER BY latency_ms`,
    [month]
  );

  return {
    month,
    requests: totals?.requests ?? 0,
    receiptReads: totals?.receipt_reads ?? 0,
    tokensIn: totals?.tokens_in ?? 0,
    tokensOut: totals?.tokens_out ?? 0,
    failures: totals?.failures ?? 0,
    medianLatencyMs: median(latencies.map((row) => row.latency_ms)),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? Math.round((values[middle - 1] + values[middle]) / 2)
    : values[middle];
}

/** Clears all telemetry. Part of §15.2's delete-all when that lands. */
export async function clearQueryLog(db: SqlDriver): Promise<number> {
  const result = await db.run('DELETE FROM query_log');
  return result.changes;
}


/**
 * The two numbers §6.8 asks for, from whatever the device has actually done.
 *
 * Computed from real use rather than a benchmark, which is the only kind of
 * measurement that answers the question. A synthetic loop would time the
 * matcher and the SQL; a user's own history times those *plus* a cold cache,
 * a sleepy radio and whatever else the handset was doing.
 *
 * Percentiles are taken with the nearest-rank method over the rows that have
 * a figure at all — a turn with no first token contributes nothing rather
 * than a zero, since null here means "no stream happened", not "instant".
 */
export interface ResponseTimes {
  /** How many turns each figure was taken over. Small samples are not evidence. */
  fastpathCount: number;
  agentCount: number;
  /** §6.8: target under 100 ms. */
  fastpathP95Ms: number | null;
  /** §6.8: target under 4 s. Time to first token, never the whole turn. */
  agentFirstTokenP50Ms: number | null;
  agentFirstTokenP95Ms: number | null;
}

/** Nearest-rank, on a list already sorted ascending. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export async function getResponseTimes(db: SqlDriver): Promise<ResponseTimes> {
  const fast = await db.all<{ latency_ms: number }>(
    `SELECT latency_ms FROM query_log
      WHERE route = 'fastpath' AND latency_ms IS NOT NULL
      ORDER BY latency_ms`
  );
  const agent = await db.all<{ first_token_ms: number }>(
    `SELECT first_token_ms FROM query_log
      WHERE route = 'agent' AND first_token_ms IS NOT NULL
      ORDER BY first_token_ms`
  );

  const fastMs = fast.map((row) => row.latency_ms);
  const agentMs = agent.map((row) => row.first_token_ms);

  return {
    fastpathCount: fastMs.length,
    agentCount: agentMs.length,
    fastpathP95Ms: percentile(fastMs, 0.95),
    agentFirstTokenP50Ms: percentile(agentMs, 0.5),
    agentFirstTokenP95Ms: percentile(agentMs, 0.95),
  };
}
