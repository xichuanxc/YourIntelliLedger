/**
 * The fastpath entry point (§6.6, §6.8).
 *
 * One function, called before any network call: if it returns an answer, no
 * model runs, nothing leaves the device, and the reply is on screen in
 * milliseconds. If it returns null — which is the common case — the agent
 * answers as it always has.
 *
 * §6.8 asks for p95 < 100 ms, so `latencyMs` is measured here rather than
 * estimated. It is the number §15.3's `query_log` records for a
 * `route='fastpath'` turn, which is how the budget gets checked against real
 * use instead of a benchmark.
 */

import { answerFastpath, type FastpathAnswer, type FastpathContext } from '@/fastpath/answer';
import { matchFastpath, type FastpathIntent } from '@/fastpath/match';

export type { FastpathAnswer, FastpathContext };

export interface FastpathResult extends FastpathAnswer {
  /** Which pattern claimed it — for `query_log`'s `tool_calls` column. */
  intent: FastpathIntent['kind'];
  latencyMs: number;
}

/**
 * Answers a question locally, or returns null to let the agent have it.
 *
 * **Never throws.** A fastpath is an optimisation, and an optimisation that
 * can break the feature it accelerates is not one — a database fault here
 * must cost a few milliseconds and fall through, not lose the question.
 */
export async function tryFastpath(
  question: string,
  context: FastpathContext
): Promise<FastpathResult | null> {
  const started = Date.now();

  try {
    const intent = matchFastpath(question, context.today);
    if (!intent) return null;

    const answer = await answerFastpath(intent, context);
    if (!answer) return null;

    return { ...answer, intent: intent.kind, latencyMs: Date.now() - started };
  } catch {
    return null;
  }
}
