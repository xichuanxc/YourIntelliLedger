/**
 * The answer envelope, §14.7 — and §6.7's promise about it:
 *
 * > An unparseable envelope falls back to showing the model's text only —
 * > never a crash.
 *
 * So nothing in this file throws. Every function takes whatever the model
 * produced and returns something renderable, reporting separately whether it
 * had to fall back. A model that returns prose instead of JSON, JSON wrapped
 * in a code fence, or an object with a `render` block full of nonsense are all
 * ordinary Tuesday behaviour, not exceptional conditions.
 *
 * `degraded` matters beyond rendering: §15.3 logs that turn as
 * `outcome='fallback'`, which is how a prompt that has started producing bad
 * envelopes shows up as a number rather than as a user complaint.
 *
 * The *rendering* rules — donut only below nine slices, tables paginated past
 * fifty rows, locale formatting — live in `src/render` (Week 8). This module
 * only decides what the envelope **is**.
 */

import { toolByName } from '@/agent/tools';

export const RENDER_TYPES = ['none', 'stat', 'table', 'bar', 'line', 'donut'] as const;
export type RenderType = (typeof RENDER_TYPES)[number];

export interface RenderSpec {
  type: RenderType;
  title?: string;
  x?: { label?: string; values: string[] };
  series?: { label?: string; values: number[] }[];
}

export interface PendingAction {
  tool: string;
  summary: string;
  ref?: string;
}

export interface AnswerEnvelope {
  text: string;
  render?: RenderSpec;
  pending_actions?: PendingAction[];
  followups?: string[];
}

/** Four chips is a suggestion; ten is a menu the user has to read. */
const MAX_FOLLOWUPS = 4;

export interface ParsedEnvelope {
  envelope: AnswerEnvelope;
  /** True when anything had to be salvaged — §15.3's `outcome='fallback'`. */
  degraded: boolean;
}

/**
 * Pulls the JSON object out of a reply that may be wrapped.
 *
 * Models fence JSON in ```json blocks and sometimes add a sentence either
 * side, both despite instructions. Recovering from that is a one-line
 * substring scan, and refusing to would throw away a perfectly good answer.
 */
function extractObject(raw: string): unknown {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length === 0 ? undefined : strings.slice(0, limit);
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)
  );
  return numbers.length === value.length ? numbers : null;
}

function parseRender(value: unknown): RenderSpec | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;

  // §14.7: "unknown `type` degrades to `text`" — so an unrecognised type is
  // not a bad chart, it is no chart, and the sentence still gets shown.
  if (!RENDER_TYPES.includes(source.type as RenderType)) return undefined;
  const type = source.type as RenderType;
  if (type === 'none') return undefined;

  const spec: RenderSpec = { type };
  if (typeof source.title === 'string') spec.title = source.title;

  const axis = source.x as Record<string, unknown> | undefined;
  const axisValues = asStringArray(axis?.values, Number.MAX_SAFE_INTEGER);
  if (axisValues) {
    spec.x = { values: axisValues };
    if (typeof axis?.label === 'string') spec.x.label = axis.label;
  }

  if (Array.isArray(source.series)) {
    const series: NonNullable<RenderSpec['series']> = [];
    for (const entry of source.series) {
      if (entry === null || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const values = asNumberArray(row.values);
      if (!values) continue;
      series.push(typeof row.label === 'string' ? { label: row.label, values } : { values });
    }
    if (series.length > 0) spec.series = series;
  }

  return spec;
}

/**
 * §6.4: write tools "return `pending_user_confirmation` to the model and end
 * the loop; the UI renders a confirmation card and commits locally on tap".
 * An action naming a read-only tool, or a tool that does not exist, is
 * therefore not a card the UI could honour — it is dropped rather than shown,
 * because §6.8's "no write ever commits without an explicit user tap" is only
 * meaningful if the tap is attached to a real write.
 */
function parseActions(value: unknown): PendingAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions: PendingAction[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.tool !== 'string' || typeof row.summary !== 'string') continue;
    if (toolByName(row.tool)?.kind !== 'write') continue;
    actions.push(
      typeof row.ref === 'string'
        ? { tool: row.tool, summary: row.summary, ref: row.ref }
        : { tool: row.tool, summary: row.summary }
    );
  }
  return actions.length === 0 ? undefined : actions;
}

/**
 * Never throws, never returns an empty answer when the model said something.
 *
 * The fallback keeps the model's own words rather than substituting an apology
 * — a correct sentence wrapped in a broken envelope is still a correct
 * sentence, and replacing it with "something went wrong" would be the app
 * losing the answer, not the model.
 */
export function parseEnvelope(raw: string): ParsedEnvelope {
  const fallback = (): ParsedEnvelope => ({ envelope: { text: raw.trim() }, degraded: true });

  const parsed = extractObject(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback();

  const source = parsed as Record<string, unknown>;
  if (typeof source.text !== 'string' || source.text.trim() === '') return fallback();

  const envelope: AnswerEnvelope = { text: source.text.trim() };

  const render = parseRender(source.render);
  if (render) envelope.render = render;

  const actions = parseActions(source.pending_actions);
  if (actions) envelope.pending_actions = actions;

  const followups = asStringArray(source.followups, MAX_FOLLOWUPS);
  if (followups) envelope.followups = followups;

  // Salvaging a field the model got wrong is still an answer we could show, so
  // it is not a fallback; only losing the envelope entirely is.
  return { envelope, degraded: false };
}
