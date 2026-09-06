# Week 7 — the machinery under Ask

## What Week 7 actually is

§11 defines it as: *"Hub deployed (§13); agent loop, streaming, `query_ledger` +
validator + compiler (§14); attestation on both platforms"*, done when
*"adversarial spec suite 100% rejected; streaming verified on physical Android
**and** iPhone."*

So Ask is the right target, but the **screen** is Week 8 — *"envelope rendering
(text/table/chart), fastpaths, followups, confirmation cards."* Week 7 builds the
engine underneath: the thing that turns a typed question into a validated query,
runs it locally, and gets an answer back.

One wrinkle that shapes the whole week: Week 7's own acceptance criterion is
*"streaming verified on physical hardware"*, and you cannot verify streaming with
no UI at all. So Week 7 ships a **deliberately thin Ask screen** — a message
list, an input box, streaming text. Charts, chips and confirmation cards stay in
Week 8. `src/app/(tabs)/ask.tsx` is currently an EmptyState placeholder, which is
exactly the right starting point.

The dependencies are already scaffolded: `src/agent/README.md` names
`loop`, `hubClient`, `prompt`, `tools/`, `validate`, `compile`; `src/fastpath/`
and `src/render/` exist; `getDataRange()` in `insightsRepo` is most of §6.3's
data catalog; `telemetryRepo.logQuery` already takes the §15.3 shape and its
header comment explicitly defers a decision to Week 7.

---

## Three tracks, and the order matters

**Track A is pure, offline, and carries the acceptance criterion.** It needs no
network, no device, no hub, and no key — it is all node-testable. It is also
where the security of this feature actually lives. It goes first.

**Track B is the hub** (`hub/PLAN-stage-b.md`, already written).

**Track C integrates** and needs a device.

A and B are independent and can interleave; C needs both.

---

## Track A — spec → SQL, offline *(~2 days)*

### A1. Tool schemas (§14.1–14.4)

Four JSON schemas shipped as constants in `src/agent/tools/`. §14's framing is
the important part: they are *"the LLM contract **and** the validator
whitelist"*, so they are one source of truth, not two that can drift.

Note `update_bill_item`'s category enum in §14.3 must equal §4.7's closed
vocabulary — import from `src/types/vocabulary.ts` rather than retyping it. A
copy here is a silent way for the model's options to drift from the database's.

### A2. `validate.ts` (§14.5) — **the acceptance criterion**

The table in §14.5 is the whole spec: unknown property → `unknown_field`; enum
mismatch → `invalid_enum` *listing the valid values*; `limit` > 50 → clamp, no
rejection; `time_range.last` out of range → clamp **and say so in the result**;
range predating the first bill → clamp and tell the model *"so it can say so"*;
non-existent filter **value** → allowed, an empty result is a legitimate answer;
`bill_id` not found → `not_found`; write tool, any failure → reject, never
partially apply.

The clamp-vs-reject split is the subtle half. Clamping silently would make the
model claim it answered a question it did not; §14.5 requires the clamp be
reported back so the answer can be honest about its own range.

**The adversarial suite is the deliverable, not a byproduct.** Week 7 is done
when 100% of malformed specs are rejected *before reaching SQL*. Cases to cover:
unknown keys, wrong enum casing, `limit: 9999`, `limit: -1`, negative and
fractional `time_range.last`, 5+ filters against `maxItems: 4`, nested objects
where scalars belong, SQL metacharacters in filter values (`'; DROP TABLE`),
`__proto__` / `constructor` as keys, unicode-normalisation tricks in enums,
absent `required` fields, `null` where a string is required, and deeply nested
payloads. Every one asserts *rejected before compile is called*.

### A3. `compile.ts` (§14.6) — one known trap

⚠️ **The itemless-bill rule is the single highest-value line in §14.** Read it
twice:

> `sum_amount` uses `SUM(bill_items.price_cents)` **only** when the dimension
> needs a `bill_items` column — otherwise `SUM(bills.total_cents)`. An itemless
> bill has zero `bill_items` rows, so a plain "how much did I spend" that joins
> through `bill_items` silently excludes every itemless bill's total.

§5.1 makes itemless bills a normal outcome, and TAIER already produces them. Get
this wrong and every monthly total is quietly low — no error, no crash, just
wrong numbers the user has no way to catch. **A test with a mixed fixture
(itemised + itemless bills in one month) is mandatory**, asserting the plain
total equals the sum of `total_cents` and not the sum of items.

Also in §14.6: `filters[].op: contains` with `field: "name"` must LIKE against
**both `name` and `name_local`** (§4.7), so `豆腐干` matches. Easy to half-implement.

And the prohibition, verbatim: *"String interpolation into SQL is prohibited
anywhere in the codebase; add a lint rule and a unit test that asserts the
compiler's output contains no user-supplied literals."* Both artefacts, not just
the test — the lint rule is what stops the next person.

### A4. Data catalog (§6.3)

~100 tokens, MMKV-cached, **invalidated on bill write**. `getDataRange()` gives
the range; categories come from the vocabulary; `merchants_top` and `bill_count`
are small queries. The invalidation hook is the part that rots silently, so it
belongs next to the write path in `ledgerRepo`, not in the agent.

---

## Track B — the hub *(see `hub/PLAN-stage-b.md`)*

Already planned in three phases. **One correction that plan does not yet
capture:** Phase 1 was scoped for the parse case — a single user turn returning
JSON. The agent needs materially more from the same endpoint:

- multi-message history (§6.3: last 6 turns)
- a `tools` array and `tool_choice`
- assistant turns containing tool calls, and tool-result turns going back
- streaming (§6.2), which parse does not use

So the Gemini translator grows: OpenAI `tools` ⇄ Gemini `functionDeclarations`,
and tool results ⇄ `functionResponse` parts. That is real work and it belongs in
Phase 1's `providers/gemini.ts`, sized accordingly.

### Recommendation: cut attestation from Week 7

§11 says *"attestation on both platforms"*, but two things have changed since
that was written:

1. iOS attestation is already deferred — §8.2's own instruction under
   personal-team signing, agreed earlier.
2. Android attestation's *app-recognition* verdict needs a Play-signed binary
   (`hub/PLAN-stage-b.md`, Phase 2), so it depends on the $25 Play Console
   account that §11 does not schedule until Week 10.

Putting a store-account dependency on Week 7's critical path is how a week
slips for reasons that have nothing to do with code. **Ship Phase 1 (BYOK relay)
in Week 7 and move Phases 2–3 to Week 9**, which §11 designates the shock
absorber. The app still gains everything you asked for — no model names, no
direct provider calls — and the key-holding hub arrives when the Play track
exists anyway.

---

## Track C — loop, streaming, thin UI *(~1.5 days, needs a device)*

### C1. Orchestrator (§6.1)

Assemble → POST → tool_call → validate → execute locally → append → repeat,
**max 8**. Final → parse envelope → render. Network error → fastpath if the
pattern matches, else offline notice. Loop cap → partial answer
(*"here's what I found so far"*), not an error.

§14.5: a validation rejection is returned **to the model** as the tool result so
it can self-correct on its single retry. A second failure ends the loop with a
plain-language apology and logs `outcome='error'`.

Every turn writes a `query_log` row. `telemetryRepo`'s header notes it currently
folds parses into `route='agent'` and says migration 002 can add a `'parse'`
route *"if Week 7 finds the distinction needs to be first-class"*. It now does —
agent turns and parses are about to be different things with different latency
profiles. Small migration, worth doing.

### C2. Streaming (§6.2) — the platform risk

RN's global `fetch` does not expose a readable stream and **silently buffers**,
which is the failure mode that looks like it works. Use `expo/fetch`.

§6.2 is unusually firm: verify on **physical hardware on both platforms**, and
*"correctness must never depend on streaming"* — if it is unstable, degrade to
non-streaming with a typing indicator. So build the non-streaming path first and
treat streaming as an enhancement layered on top. That ordering also means a bad
streaming result costs a fallback, not a rebuild.

Known environmental friction: iOS→Metro needs the phone and laptop on the same
subnet (campus Wi-Fi client isolation has blocked this repeatedly); Android is
unaffected because `adb reverse` goes over USB.

### C3. Thin Ask screen

Message list, input, send, streaming text, error states. Explicitly **not**
Week 7: charts, tables, followup chips, confirmation cards, fastpaths.

§7's non-negotiables still apply even to a thin screen — Android system back
must be handled, iOS swipe-back must not break, safe-area insets on both, and an
empty state that explains the next action.

---

## Acceptance (§6.8, §11)

| Criterion | Track | Verified by |
|---|---|---|
| 100% of adversarial specs rejected before SQL | A | node test suite |
| No SQL string interpolation | A | lint rule + unit test |
| Itemless bills counted in plain totals | A | mixed-fixture test |
| Streaming verified on physical Android **and** iPhone | C | manual, both devices |
| Agent p50 < 4 s to first token, both platforms | C | measured, not estimated |
| No write commits without a tap | C | write tools return `pending_user_confirmation` |

Fastpath p95 < 100 ms is §6.8's but the fastpaths themselves are Week 8; the
routing hook goes in during Week 7 so there is somewhere for them to land.

---

## Honest sizing

Track A ~2 d · Track B Phase 1 ~1.5 d (grown for tools) · Track C ~1.5 d
→ **~5 days**, with attestation moved out. With attestation and its Play
dependency, ~8 days — which is why the recommendation above exists.

This is the heaviest week in §11 by some margin: it is the only one carrying a
new backend, a new subsystem, a platform risk flagged with a ⚠️, and a 100%
acceptance bar. Being ahead of schedule is what makes it affordable.

## Suggested order

```
A1 → A2 → A3 → A4        offline, testable, no device, carries the bar
   ↘ B-Phase1 (interleave)
        ↘ C1 → C2 → C3   integration, needs device
```

Starting with A means that if the week compresses, what survives is the
validated, tested, security-critical half — and what slips is the half that is
mostly wiring.
