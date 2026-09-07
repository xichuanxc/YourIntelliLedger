/**
 * Running a tool call locally — the "execute locally" step of §6.1.
 *
 * Everything the model asks for arrives here as a name and a string of JSON,
 * and leaves as a string of JSON. Three things are true of every path through
 * this file:
 *
 * 1. **Nothing throws.** A failure is a tool *result*, because §14.5 returns
 *    rejections to the model so it can correct itself on its single retry. An
 *    exception would end the conversation instead of teaching it.
 * 2. **Nothing that has not been through `validate.ts` reaches the database.**
 *    The only route to `compile.ts` is a `ValidatedQuery`.
 * 3. **No write is applied.** §6.4: write tools return
 *    `pending_user_confirmation` and the UI commits on a tap. There is no code
 *    path here that mutates anything, which is what makes §6.8's "no write
 *    ever commits without an explicit user tap" a property rather than a
 *    promise.
 */

import { compileQuery } from '@/agent/compile';
import type { ToolCall } from '@/agent/messages';
import { toolByName } from '@/agent/tools';
import { validateToolCall, type ValidationContext } from '@/agent/validate';
import type { SqlDriver } from '@/data/driver';
import { getBill } from '@/data/ledgerRepo';
import { unitBasisLabel, unitPriceOf, type UnitPriceInput } from '@/data/unitPrice';

export interface ExecutionContext {
  db: SqlDriver;
  validation: ValidationContext;
}

export type ExecutionStatus =
  /** A result the model can use. */
  | 'ok'
  /** A rejection (§14.5). The model gets one retry. */
  | 'rejected'
  /** A write, waiting on the user's tap (§6.4). */
  | 'pending';

/**
 * A name in the answer that a tool result can prove belongs to a bill.
 *
 * Collected from rows rather than asked of the model. A citation the model
 * invents is exactly as convincing as one it did not, and a link to the wrong
 * receipt is worse than no link — so the only names that can become links are
 * ones the database returned alongside the bill they came from.
 */
export interface BillReference {
  billId: number;
  /** The item or merchant name, spelled as it is stored. */
  label: string;
}

export interface ExecutionResult {
  /** The tool message content, verbatim. */
  content: string;
  status: ExecutionStatus;
  /** Names this result can vouch for. Never sent to the model. */
  references?: BillReference[];
}

function reply(
  payload: unknown,
  status: ExecutionStatus,
  references?: BillReference[]
): ExecutionResult {
  return { content: JSON.stringify(payload), status, ...(references ? { references } : {}) };
}

function reference(billId: unknown, label: unknown): BillReference | null {
  if (typeof billId !== 'number' || typeof label !== 'string') return null;
  const trimmed = label.trim();
  return trimmed === '' ? null : { billId, label: trimmed };
}

/**
 * Which rows carry a bill to link to.
 *
 * Only the two list shapes do. An aggregate row is a sum over many bills and
 * has no single receipt behind it — "$214 on groceries" is not a link, and
 * pretending otherwise would send the user to whichever bill happened to be
 * first.
 */
function referencesFrom(shape: string, rows: Record<string, unknown>[]): BillReference[] {
  const found: BillReference[] = [];

  for (const row of rows) {
    if (shape === 'items') {
      // Both spellings (§4.7): the model may answer in either, and the local
      // name is the one a bilingual user is most likely to have asked with.
      for (const key of ['name', 'name_local']) {
        const entry = reference(row.bill_id, row[key]);
        if (entry) found.push(entry);
      }
    } else if (shape === 'bills') {
      const entry = reference(row.id, row.merchant);
      if (entry) found.push(entry);
    }
  }

  return found;
}

function rejection(code: string, message: string): ExecutionResult {
  return reply({ error: code, message }, 'rejected');
}

/**
 * `arguments` is JSON *text* from a language model, so it is sometimes not
 * JSON. Treated as a rejection rather than a crash: the model can see what it
 * emitted and fix it.
 */
function parseArguments(raw: string): { ok: true; value: unknown } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/**
 * Adds a comparable price to each item row.
 *
 * A shelf price cannot answer "which milk was better value" — that needs a
 * common denominator, and §4.9 stores three different kinds of quantity, only
 * one of which divides out directly. `unitPriceOf` reconciles them; `source`
 * travels with the number because a rate read off a product name is a reading
 * of packaging text, not a measurement, and the model should be able to say so
 * rather than quoting it with the confidence of a printed rate.
 */
function withUnitPrices(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const rate = unitPriceOf({
      name: String(row.name ?? ''),
      nameLocal: typeof row.name_local === 'string' ? row.name_local : null,
      qty: typeof row.qty === 'number' ? row.qty : 1,
      unit: (row.unit ?? 'pc') as UnitPriceInput['unit'],
      priceCents: typeof row.price_cents === 'number' ? row.price_cents : null,
      unitPriceCents: typeof row.unit_price_cents === 'number' ? row.unit_price_cents : null,
    });

    if (!rate) return row;
    return {
      ...row,
      unit_price_cents_each: rate.cents,
      unit_price_basis: unitBasisLabel(rate.basis),
      unit_price_source: rate.source,
    };
  });
}

async function runQuery(
  args: Parameters<typeof compileQuery>[0],
  notes: string[],
  context: ExecutionContext
): Promise<ExecutionResult> {
  const compiled = compileQuery(args);
  const raw = await context.db.all<Record<string, unknown>>(compiled.sql, compiled.params);
  const rows = compiled.shape === 'items' ? withUnitPrices(raw) : raw;

  return reply(
    {
      rows,
      row_count: rows.length,
      // Which source the money came from, so the model can be honest about
      // the gap §14.6 creates: a category breakdown cannot include a bill
      // whose items were illegible, while a plain total does.
      amounts_from:
        args.metric === 'count' || args.metric.startsWith('list')
          ? undefined
          : compiled.grain === 'item'
            ? 'item_prices'
            : 'printed_bill_totals',
      notes: notes.length > 0 ? notes : undefined,
    },
    'ok',
    referencesFrom(compiled.shape, rows)
  );
}

async function runBillDetail(
  billId: number,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const bill = await getBill(context.db, billId);
  // §14.5's one row this project cannot check without the database.
  if (!bill) return rejection('not_found', 'There is no bill with id ' + String(billId) + '.');

  return reply(
    {
      id: bill.id,
      merchant: bill.merchant,
      purchased_at: bill.purchasedAt,
      total_cents: bill.totalCents,
      currency: bill.currency,
      // §4.11's integrity flags: the model should be able to say "the items on
      // this receipt do not add up to its total" rather than quietly picking
      // one of the two numbers.
      parse_flags: bill.parseFlags,
      items: bill.items.map((item) => {
        const rate = unitPriceOf(item);
        return {
          id: item.id,
          name: item.name,
          name_local: item.nameLocal,
          category: item.category,
          qty: item.qty,
          unit: item.unit,
          price_cents: item.priceCents,
          ...(rate
            ? {
                unit_price_cents_each: rate.cents,
                unit_price_basis: unitBasisLabel(rate.basis),
                unit_price_source: rate.source,
              }
            : {}),
        };
      }),
    },
    'ok',
    [
      ...(bill.merchant ? [{ billId: bill.id, label: bill.merchant }] : []),
      ...bill.items.flatMap((item) =>
        [item.name, item.nameLocal]
          .map((label) => reference(bill.id, label))
          .filter((entry): entry is BillReference => entry !== null)
      ),
    ]
  );
  // `raw_text` is deliberately absent. It is cold audit data (§4.4), it would
  // dominate the token cost of this result, and §0 puts only "per-question
  // minimal payloads" on the wire.
}

export async function executeToolCall(
  call: ToolCall,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const tool = toolByName(call.function.name);
  if (!tool) {
    return rejection('unknown_tool', 'There is no tool called ' + JSON.stringify(call.function.name) + '.');
  }

  const parsed = parseArguments(call.function.arguments);
  if (!parsed.ok) {
    return rejection(
      'malformed_arguments',
      'The arguments were not valid JSON. Send the arguments as a JSON object.'
    );
  }

  const validated = validateToolCall(call.function.name, parsed.value, context.validation);
  if (!validated.ok) return rejection(validated.code, validated.message);

  // §6.4. Deliberately before any branch that could touch the database — the
  // write tools have no execution path at all, rather than one that is
  // currently unreachable.
  if (tool.kind === 'write') {
    return reply({ status: 'pending_user_confirmation' }, 'pending');
  }

  try {
    switch (validated.call.name) {
      case 'query_ledger':
        return await runQuery(validated.call.args, validated.notes, context);
      case 'get_bill_detail':
        return await runBillDetail(validated.call.args.bill_id, context);
      default:
        return rejection('unknown_tool', 'That tool cannot be executed.');
    }
  } catch {
    // A database fault is not the model's mistake, but it is still the model
    // that has to say something about it. §15.3 logs the turn either way.
    return rejection('execution_failed', 'That query could not be run. Try a simpler question.');
  }
}
