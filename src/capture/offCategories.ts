/**
 * Open Food Facts taxonomy → the §4.7 closed category vocabulary.
 *
 * §5.5 check 5 says an Open Food Facts hit "overrides the model's
 * name/category" without saying how, and the two vocabularies are not
 * comparable. OFF returns a deep hierarchical tag list:
 *
 *     en:plant-based-foods, en:cereals-and-potatoes, en:breakfast-cereals,
 *     en:mueslis
 *
 * §4.7 has ten flat values enforced by a SQL `CHECK`, so an unmapped tag is
 * not a slightly-wrong category — it is a failed write. This module is that
 * mapping, kept pure so it is testable without a network.
 *
 * ## Why "most specific wins"
 *
 * OFF orders its tags roughly general → specific, and the general end is
 * useless here: nearly every grocery item carries `en:plant-based-foods` or
 * `en:foods`. Matching the *last* tag that maps gives `en:mueslis` →
 * `pantry_staple` rather than stopping at a tag that fits everything.
 *
 * ## Why unmapped means "keep the model's answer"
 *
 * Returning `other` for an unrecognised tag would be worse than not looking
 * up at all: the model read the line in the context of a real receipt, and
 * `other` throws that away for a taxonomy gap. So this returns null and the
 * caller leaves the category alone — the override only fires where the
 * mapping is unambiguous.
 */

import type { Category } from '@/types/vocabulary';

/**
 * Tag fragment → category, checked against each tag in order of specificity.
 *
 * Fragments rather than whole tags because OFF tags are language-prefixed
 * (`en:`, `fr:`) and pluralised inconsistently. Substring matching is loose,
 * which is why the list is ordered: the first entry whose fragment appears in
 * a tag wins for that tag, so narrower fragments must precede broader ones.
 */
const TAG_MAP: ReadonlyArray<readonly [fragment: string, category: Category]> = [
  // A drink made of milk is a drink. Ordering the beverage block before dairy
  // is not enough on its own — that only settles a tag matching two fragments,
  // and here the clash is *between* tags ("en:beverages" then
  // "en:plant-based-milks", where the later, more specific tag wins). So the
  // milk-shaped drinks are named explicitly, ahead of the bare "milk".
  ['plant-based-milk', 'beverage'],
  ['milk-drink', 'beverage'],
  ['milk-substitute', 'beverage'],
  ['milkshake', 'beverage'],

  ['beverage', 'beverage'],
  ['drinks', 'beverage'],
  ['waters', 'beverage'],
  ['juice', 'beverage'],
  ['coffee', 'beverage'],
  ['teas', 'beverage'],
  ['sodas', 'beverage'],

  // Frozen before everything: a frozen pizza is frozen first (§4.7 treats
  // frozen as a storage state, and the user shops that way).
  ['frozen', 'frozen'],
  ['ice-cream', 'frozen'],

  ['dairy', 'dairy'],
  ['milk', 'dairy'],
  ['cheese', 'dairy'],
  ['yogurt', 'dairy'],
  ['yoghurt', 'dairy'],
  ['butter', 'dairy'],
  ['cream', 'dairy'],
  ['eggs', 'dairy'],

  ['meat', 'meat'],
  ['poultry', 'meat'],
  ['chicken', 'meat'],
  ['beef', 'meat'],
  ['pork', 'meat'],
  ['fish', 'meat'],
  ['seafood', 'meat'],
  ['charcuterie', 'meat'],

  ['bread', 'bakery'],
  ['bakery', 'bakery'],
  ['pastries', 'bakery'],
  ['viennoiserie', 'bakery'],

  ['fresh-vegetables', 'produce'],
  ['fresh-fruits', 'produce'],
  ['vegetables', 'produce'],
  ['fruits', 'produce'],
  ['salads', 'produce'],
  ['herbs', 'produce'],

  ['snack', 'snacks'],
  ['confectioner', 'snacks'],
  ['chocolate', 'snacks'],
  ['biscuit', 'snacks'],
  ['crisps', 'snacks'],
  ['chips', 'snacks'],
  ['sweets', 'snacks'],
  ['candies', 'snacks'],

  ['cereals', 'pantry_staple'],
  ['pasta', 'pantry_staple'],
  ['rice', 'pantry_staple'],
  ['flour', 'pantry_staple'],
  ['sugar', 'pantry_staple'],
  ['condiment', 'pantry_staple'],
  ['sauce', 'pantry_staple'],
  ['oils', 'pantry_staple'],
  ['spread', 'pantry_staple'],
  ['canned', 'pantry_staple'],
  ['legumes', 'pantry_staple'],
  ['groceries', 'pantry_staple'],

  // Open Food Facts is food-first, but it does carry some non-food.
  ['cleaning', 'household'],
  ['detergent', 'household'],
  ['hygiene', 'household'],
  ['cosmetic', 'household'],
  ['household', 'household'],
];

/**
 * Best §4.7 category for an Open Food Facts tag list, or null when nothing
 * maps confidently.
 *
 * Null is a real answer, not a failure: it means "leave the model's category
 * alone". See the note above on why `other` would be worse.
 */
export function categoryFromOffTags(tags: readonly string[] | undefined): Category | null {
  if (!tags?.length) return null;

  // Last match wins: OFF orders tags general → specific, and the general end
  // ("en:foods", "en:plant-based-foods") fits nearly everything.
  let match: Category | null = null;

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [fragment, category] of TAG_MAP) {
      if (lower.includes(fragment)) {
        match = category;
        break;
      }
    }
  }

  return match;
}
