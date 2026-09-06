/**
 * The JSON Schema subset the four tool declarations are written in — §14.
 *
 * §14 opens by calling these schemas "the LLM contract **and** the validator
 * whitelist". That is only true if there is literally one artefact: the objects
 * in this directory are what goes on the wire to the model, and `validate.ts`
 * (§14.5) walks those same objects to decide what is allowed back in. A
 * hand-written validator sitting beside a hand-written schema is two things
 * that can disagree, and the disagreement stays invisible until a malformed
 * spec reaches SQL.
 *
 * So the type is deliberately loose — every field optional, no discriminated
 * union. Its job is to describe *exactly* the JSON a provider accepts in a
 * function declaration, not to be pleasant to build by hand. An empty `{}` is
 * a legal schema meaning "any value", which §14.1's `filters[].value` needs.
 *
 * `additionalProperties` is absent on purpose. §14.5's first row rejects any
 * unknown property, so the validator treats every declared object as closed
 * already; saying so again in the wire JSON would add a keyword that not every
 * provider's function-calling subset accepts, for no behavioural gain.
 */

export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly minProperties?: number;
  readonly items?: JsonSchema;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly description?: string;
}

export const TOOL_NAMES = [
  'query_ledger',
  'get_bill_detail',
  'update_bill_item',
  'delete_bill',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Exactly the object sent to the provider — nothing app-side may leak in here.
 * §13.7 forwards message content byte-for-byte, so whatever is in this object
 * is on the wire verbatim.
 */
export interface FunctionDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: JsonSchema;
}

export interface ToolSpec {
  readonly declaration: FunctionDeclaration;
  /**
   * Writes need a tap before they take effect (§6.1) and, per §14.5's last
   * row, are never partially applied. It lives beside the declaration rather
   * than inside it because it is not part of any provider's function-call
   * format — the model learns the same fact from the description prose.
   */
  readonly kind: 'read' | 'write';
}
