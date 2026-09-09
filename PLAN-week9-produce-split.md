# Optional (Week 9) — splitting `produce` into fruit and vegetables

**Status:** proposed, not scheduled. Week 9 is §11's hardening week and the
shock absorber; this belongs there or nowhere.

**Why it is optional:** "how much on fruit versus vegetables" is a real
question, but nothing else depends on the answer. §11's own risk order is to
drop voice input first, then chart types, then fastpaths — this sits in the
same class of thing, and it touches the parsing prompt, which is what §5.7's
accuracy figures are measured against.

---

## The rule has to be decided before anything is built

Every `produce` line in the eleven-receipt corpus:

| Item | |
|---|---|
| Banana · Bananas · Mandarin | fruit, unambiguously |
| Carrots · Table Carrots · Broccoli · Bok Choy · Orange Kumara | vegetable, unambiguously |
| **Tomatoes · NZ Tomato · Green Capsicum** | **botanically fruit, culinarily vegetable** |

Three of eleven are a judgement call. A closed vocabulary (§4.7) exists so that
analytics cannot drift, and a category the model assigns differently on
different weeks is worse than a coarser one it always gets right — the drift is
invisible and the totals are quietly wrong.

**So: culinary, not botanical.** Tomato, capsicum, cucumber, courgette,
pumpkin, avocado and aubergine are `vegetable`. This goes in the parsing prompt
**with those examples named**, because that is the only way the model applies
it consistently. Rhubarb is the same problem in reverse and is a vegetable by
the same rule.

Worth stating plainly in the prompt: the test is *how it is eaten and shopped
for*, not what a botanist would say.

---

## What existing bills do — decide this second

A ledger already holds `produce` rows. Three ways to treat them:

**1. Keep `produce` as a legacy value.** No data migration, and nothing false
is asserted. The cost is three overlapping buckets in every breakdown until old
bills age out, which on a personal ledger could be a year.

**2. Map `produce` → `vegetable`.** One statement in the migration, and it
silently claims the bananas were vegetables. §4.11 is explicit that a parse is
never silently corrected, and this is the same act one layer down.

**3. Re-parse from the cached OCR.** §4.6 caches `receipt_scans` for exactly
this — "enables re-parse without re-scan". The new prompt re-reads the real
receipt and classifies honestly. Costs an API call per bill and can move other
fields too, so it cannot be automatic.

**Recommended: 1, with 3 offered as an action.** The legacy value keeps every
existing total correct and every existing bill honest; a "re-parse this bill"
button drains the old category over time for anyone who cares. Label it
"Produce (unsorted)" in the UI so the three buckets read as a transition rather
than a mess.

---

## The work

### 1. Migration 003 — the only difficult part

`bill_items.category` carries a `CHECK (category IN (…))` from migration 001,
and **SQLite cannot alter a CHECK constraint**. It needs the full table
rebuild, in one transaction:

1. `PRAGMA foreign_keys = off`
2. create `bill_items_new` with the widened CHECK
3. `INSERT INTO bill_items_new SELECT … FROM bill_items`
4. `DROP TABLE bill_items`
5. `ALTER TABLE bill_items_new RENAME TO bill_items`
6. recreate `idx_items_bill`, `idx_items_cat_bill`, `idx_items_barcode`
7. `PRAGMA foreign_key_check`
8. `PRAGMA foreign_keys = on`

Migration 002 was an `ADD COLUMN`; this is the first rebuild, and it is where
the risk is. `bill_items` has a foreign key to `bills` with `ON DELETE
CASCADE`, so step 7 is not optional — a rebuild that loses the cascade would
leave orphaned items behind every deleted bill, and nothing would say so.

**The test that matters:** a database seeded with the corpus, migrated, and
then checked for row count, every column value, all three indexes, and that
deleting a bill still cascades. Not "the migration ran".

### 2. Vocabulary and prompt, in one commit

§4.7 requires it: "changing a vocabulary requires a migration *and* a prompt
update in the same commit."

- `src/types/vocabulary.ts`: `fruit`, `vegetable` added, `produce` retained,
  `CATEGORY_LABELS` gains "Fruit", "Vegetables", "Produce (unsorted)".
- `src/capture/prompts/receipt-parse-text.md`: the closed list, plus the
  culinary rule with its named examples. Regenerate `receiptParseText.ts`.
- §4.7 of the spec itself.

Everything else follows automatically, which is the payoff for the vocabulary
having had one home all along: §14.3's tool schema imports `CATEGORIES`, §6.3's
data catalog publishes them, and the Insights donut and manual-entry chips
render whatever is in the array.

About 21 hardcoded `'produce'` uses, nearly all test fixtures.

### 3. Re-measure, do not assume

§5.7's accuracy figures were measured against the current prompt. A new
category is a new way to be wrong, and the ambiguous items are exactly the ones
a model gets inconsistent about. Re-run the corpus fixtures and compare
per-item, not in aggregate: a split that is 100% right on carrots and 60% right
on tomatoes averages out to something that looks fine.

---

## Sizing

| | |
|---|---|
| Migration 003 + its tests | ~half a day, most of it the rebuild test |
| Vocabulary, prompt, spec | ~2 hours |
| Fixture updates | ~1 hour |
| Accuracy re-measurement | ~2 hours |

Roughly **one day**, and it is genuinely optional. If Week 9 is tight, this is
the first thing to drop — the ledger is completely usable with one `produce`
bucket, and nothing else in the app is waiting on it.
