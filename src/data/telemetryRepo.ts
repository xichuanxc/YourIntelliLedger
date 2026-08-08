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
  /** Hub error code (§13.6) when one applies. */
  errorCode?: string | null;
  /** Names only — §15.3 is explicit that no values are recorded. */
  toolCalls?: string[];
}

export async function logQuery(db: SqlDriver, entry: QueryLogEntry): Promise<void> {
  await db.run(
    `INSERT INTO query_log
       (at, route, tokens_in, tokens_out, model_alias, latency_ms, error_code, outcome, tool_calls)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      nowUtc(),
      entry.route,
      entry.tokensIn ?? null,
      entry.tokensOut ?? null,
      entry.modelAlias ?? null,
      entry.latencyMs ?? null,
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
