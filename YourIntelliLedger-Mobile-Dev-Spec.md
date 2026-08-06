# YourIntelliLedger — Mobile Application Development Specification

**Version:** 2.10 · **Date:** July 2026 · **Covers:** Weeks 3–10 of the 10-week plan
**Platforms:** Android and iOS from a single codebase
**Companion docs:** `YourIntelliLedger-Proposal.md`, `receipt-parse-prompt-v3.md`, `ocr_prototype.py`

**Changed in v2.10** — §12 item 1 (New Architecture gate) resolved for
Android: ran a real `expo prebuild` + `./gradlew assembleDebug` against
`MobileApp/` rather than trusting React Native Directory's "untested"
label, and both ML Kit packages compile, link, and produce a working APK
under Fabric/TurboModules. Along the way, found the build JDK matters more
than New Architecture did here — JDK 26 (this machine's default) fails
outright on an unrelated `jlink` toolchain error that also broke
`react-native-svg` and `react-native-masked-view`; JDK 17 fixed it. Added
as a standing requirement in §1.1, not just a one-time note. iOS side of
this gate is still open. §2.3's `app.config.ts` example also corrected:
`@react-native-ml-kit/text-recognition` doesn't ship an Expo config plugin
(verified against the installed package — no `app.plugin.js`, autolinks
instead), so it doesn't belong in the `plugins` array; listing it there
breaks `expo prebuild`'s plugin resolution.

**Changed in v2.9** — §2.1's layout now shows `app/` nested under `src/`
(`src/app/`), matching `create-expo-app`'s current default template, which
is what the actual scaffolded project (`MobileApp/`) uses. Purely a path
depth change — every other directory in §2.1 is unaffected, and this isn't
a departure from Expo Router convention, just a newer default than when
this section was first written.

**Changed in v2.8** — the OCR-then-LLM path this spec actually commits to
(§5.1) has now been tested end to end in the Python prototype, not just
assumed: ~96.3% mean field accuracy on the eleven-receipt corpus, ~1.2
points behind a direct-image reference parse (§5.7). Two things that
testing it for real surfaced and assuming it wouldn't have: recognition
language must be configured explicitly or non-Latin script is silently
dropped, not misread (§3, `ocr_prototype.py`'s `RECOGNITION_LANGUAGES`);
and discount-to-item attribution is measurably weaker once a receipt is
flattened to text instead of read as an image (§5.7). No schema change.

**Changed in v2.7** — `parse_receipt` can now return an itemless bill for a
receipt that isn't a goods purchase (restaurant/cafe bill, service invoice)
instead of declining it outright, so the payment is still recorded even
though there's nothing to itemize honestly (§5.1, §5.5, §5.6, §4.4). No
schema change — itemless bills were already representable, just not
reachable from the receipt-capture path until now. Proven against a real
restaurant receipt in the Python prototype before landing here.

**Changed in v2.6** — clarified what the §5.7 / §10 fixture-corpus accuracy
figure actually measures (AI-graded-by-AI, backstopped by non-AI checks
where possible — see §5.7). No schema or behaviour change.

**Changed in v2.5** — two columns added after Python-prototype validation
(§4.4): `bills.merchant_address` (§4.14, navigation) and
`bill_items.unit_price_cents` (§4.9, weighed-item rate — this is also what
finally gives the §5.5 #6 sanity check a `rate` to check against). Both were
proven against the five-receipt corpus before landing here.

> **How to read this document.** Sections are platform-neutral by default. Anything that differs
> between platforms is marked **[A]** for Android and **[i]** for iOS. If a section has no marker,
> it applies identically to both.

---

## 0. Scope & assumptions

| Item | Decision |
|---|---|
| Platform approach | React Native (Expo **development build** — native modules required, so Expo Go is not usable) |
| Targets | Android **and** iOS from one project, one codebase |
| Release order | Android first (Play internal testing), iOS follows within the same cycle |
| Feature scope | Ledger + capture + NL agent. **Pantry/inventory is out of scope** for v1; schema hooks retained (§4.13) |
| Language | TypeScript (strict mode) |
| Data residency | All records local; only per-question minimal payloads leave the device |

**Deferred to v2 (documented, not built):** pantry inventory, expiry tracking, meal suggestion, household sharing/sync, voice input (optional stretch in Wk 9).

**Cross-platform principle:** *platform differences live at the leaves, behind shared interfaces.* Business logic — database, repositories, query compiler, validator, agent loop, prompt assembly, fastpaths, renderer — contains **no** platform branching.

---

## 1. Platform targets

### 1.1 Android **[A]**
| Property | Value | Note |
|---|---|---|
| `minSdkVersion` | **24** (Android 7.0) | ML Kit needs 21+; 24 covers >98% of devices |
| `compileSdk` / `targetSdk` | Latest required by Play | **Verify the current Play requirement before release** — it advances annually |
| ABIs | `arm64-v8a`, `armeabi-v7a`, `x86_64` | Ship AAB; Play splits per-ABI |
| Artifact | Android App Bundle (.aab) | |
| Build JDK | **17** (Temurin or equivalent) | Not whatever's newest/pre-installed — JDK 26 fails the current AGP's `jlink`/`androidJdkImage` step outright (§12 item 1). Pin this in CI and local setup docs |

### 1.2 iOS **[i]**
| Property | Value | Note |
|---|---|---|
| Minimum iOS | **15.1** | Matches ML Kit's floor and current RN support; covers the vast majority of active devices |
| Devices | iPhone only for v1 (iPad renders but is not optimised) | Portrait-locked |
| Dev install | Local build (`expo run:ios --device`) signed with a personal team; **Developer Mode** enabled on the device (Settings → Privacy & Security) | No hosted build service needed for day-to-day testing |
| Re-signing | Development provisioning expires after ~7 days | Re-sign from Xcode; plan for it in the weekly rhythm |

### 1.3 Shared
| Property | Value |
|---|---|
| JS engine | Hermes |
| RN architecture | New Architecture (Fabric/TurboModules) — **gate:** confirm all native deps support it by end of Wk 3 |
| Orientation | Portrait only |
| Test matrix | **[A]** low-end (2 GB RAM, Android 10), mid (Android 13), recent (Android 15+) · **[i]** oldest supported iPhone available + one recent · plus both simulators/emulators |

> A physical device on each platform is mandatory. Camera timing and network streaming (§6.2) are precisely what simulators misrepresent.

---

## 2. Project structure

### 2.1 Layout

`app/` lives **under** `src/`, not at the project root. `create-expo-app`'s
own current default template scaffolds `src/app/` out of the box — an
official, long-supported Expo Router convention (not a workaround), just a
different default than when this section was first written. Same
structure, one level deeper; every other path below is unaffected.

```
src/
  app/                         # expo-router screens — shared, no platform forks
    (tabs)/index.tsx            # Ledger list
    (tabs)/ask.tsx              # Agent chat
    (tabs)/insights.tsx         # Summaries
    capture/camera.tsx
    capture/review.tsx
    bill/[id].tsx
    settings/*.tsx

  data/          db, migrations, ledgerRepo, insightsRepo, catalog, prefs   # 100% shared
  agent/         loop, hubClient, prompt, tools/, validate, compile         # 100% shared
  fastpath/      regex + date parsing                                       # 100% shared
  render/        envelope → text / table / chart                            # 100% shared
  capture/       scanner, camera, OCR, geometry, line reconstruction                   # ~95% shared
  ui/            components, theme                                          # mostly shared
  types/         QuerySpec, AnswerEnvelope, …                               # 100% shared

  platform/                   # ← the ONLY place platform forks are permitted
    attestation.ts            #   shared interface + types
    attestation.android.ts    #   Play Integrity
    attestation.ios.ts        #   App Attest
    privacy.ts                #   interface
    privacy.android.ts        #   allowBackup=false, FLAG_SECURE
    privacy.ios.ts            #   exclude DB from iCloud backup

app.config.ts                 # single source of native configuration
plugins/                      # config plugins where no official plugin exists
__tests__/                    # unit + integration
e2e/                          # Maestro flows (runs on both platforms)
assets/receipts/              # OCR fixture corpus
ios/  android/                # GENERATED — gitignored (§2.3)
```

### 2.2 Rules
1. Screens never import `db.ts` or DAOs — only repositories.
2. Agent tools never import one another.
3. **No `Platform.OS` branching outside `src/platform/`** except for trivial cosmetics (a padding value, a haptic style), where `Platform.select()` inline is acceptable.
4. The bundler resolves `.android.ts` / `.ios.ts` automatically; callers import the bare path (`@/platform/attestation`) and stay unaware of the fork.
5. Any new native capability gets a shared interface **first**, then per-platform implementations.

### 2.3 Continuous Native Generation
`ios/` and `android/` are **generated** by `expo prebuild` and **not committed**. All native configuration is declared once:

```ts
// app.config.ts
export default {
  name: 'YourIntelliLedger',
  slug: 'yourintelliledger',
  orientation: 'portrait',
  android: {
    package: 'nz.yourintelliledger.app',
    allowBackup: false,                       // §8.2 [A]
    permissions: ['CAMERA'],
  },
  ios: {
    bundleIdentifier: 'nz.yourintelliledger.app',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        'Used to photograph receipts so purchases can be recorded automatically.',
      NSPhotoLibraryUsageDescription:
        'Used to import a receipt photo you have already taken.',
    },
  },
  plugins: ['expo-camera', 'expo-secure-store'],
  // NOT '@react-native-ml-kit/text-recognition' or /barcode-scanning — neither
  // ships an app.plugin.js (verified against the installed packages); both
  // autolink via the RN CLI + CocoaPods instead. Listing a plugin-less
  // package here breaks `expo prebuild`'s plugin resolution (v2.10).
};
```

**Why:** upgrades and native-dependency changes become a config edit plus a regenerate, instead of merge conflicts across two large generated trees. Native changes with no existing plugin are expressed as a local config plugin in `plugins/`, never as hand-edits to `ios/`.

---

## 3. Dependencies

| Concern | Package | Platform notes |
|---|---|---|
| Runtime | `expo` (dev build) + `expo-router` | — |
| Database | `expo-sqlite` | Same API both platforms |
| Key-value | `react-native-mmkv` | — |
| Secrets | `expo-secure-store` | **[A]** Keystore · **[i]** Keychain — one API |
| **Document scanner** | `react-native-document-scanner` *(or `react-native-document-scanner-plugin`)* | **[i]** VisionKit `VNDocumentCameraViewController` · **[A]** ML Kit Document Scanner. One API, both platforms. **Primary capture path** (§5.2) |
| Camera (fallback) | `expo-camera` | Used when the document scanner is unavailable, and for gallery imports |
| Image ops | `expo-image-manipulator` | — |
| OCR | `@react-native-ml-kit/text-recognition` | ML Kit ships for **both** platforms; returns blocks/lines **with frames** |
| Barcode | `@react-native-ml-kit/barcode-scanning` | — |
| Charts | `react-native-gifted-charts` *(or `victory-native` XL if Skia is acceptable)* | — |
| Networking | `expo/fetch` streaming API *(fallback: `react-native-sse`)* | **See §6.2** |
| Notifications | `expo-notifications` | v2 hook |
| State | `zustand` | — |
| Attestation | Play Integrity **[A]** · App Attest **[i]** | Behind `src/platform/attestation` |
| Testing | `jest`, `@testing-library/react-native`, Maestro | Maestro drives both platforms |

**Decision — use ML Kit on both platforms.** Apple's Vision framework is a credible iOS alternative and is arguably stronger on iOS, but running different recognisers per platform yields two different OCR error distributions, which would fork the receipt-parsing prompt and double the fixture corpus. One recogniser, one set of quirks, one prompt. Revisit only if iOS accuracy proves inadequate in Week 5.

**Recognition language must be configured explicitly, or non-Latin script vanishes rather than misreads.** The Python prototype hit this for real testing the OCR-then-LLM path (§5.1) against Apple's Vision framework: with no recognition language specified, every Chinese character on the bilingual test receipts came back as *nothing* — not a misread glyph, an absent one — because Vision's default recognition languages don't include Chinese unless requested, and requesting it out of order (`en-US` before `zh-Hans`) recovered none of it either; order matters, not just presence. `@react-native-ml-kit/text-recognition` is a different engine, but the same category of risk applies: **verify during Week 5 which scripts ML Kit's default configuration actually recognises**, and configure it explicitly for every script the target users' receipts can contain — don't assume "OCR failed to read it" when the real failure mode can be "OCR never looked for it." This directly gates §4.10's bilingual search: a `name_local` that was silently dropped at the OCR step can't be searched for later no matter how good the LLM step is.

**App size — bundled vs unbundled ML Kit model. [A]** Android can bundle the model in the app (+~4–5 MB, works offline immediately) or fetch it via Play Services on first use (smaller download, brief first-run delay). Choose **bundled**: offline capture on first launch is required by NFR-6. On iOS the model is always bundled, so this choice only affects Android.

---

## 4. Data layer *(fully shared)*

### 4.1 Engine configuration
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
```
Opened once at app start and exposed through `db.ts`.

**Database file location.** **[A]** app-private internal storage · **[i]** app sandbox `Library/`, explicitly **excluded from iCloud backup** (§8.2). `expo-sqlite` handles placement; the backup-exclusion flag does not happen by itself.

### 4.2 What lives where *(and why the table count is small)*

| Data | Home | Reason |
|---|---|---|
| Bills, line items | **SQLite** | Queried, aggregated, joined — the whole point of the app |
| Cached OCR text | **SQLite** (`receipt_scans`) | Large, cold; separated from the hot `bills` row (§4.6) |
| Usage telemetry | **SQLite** (`query_log`) | Needs aggregation for Settings and the §8.4 budgets |
| Receipt images | **Files** on app-private storage | Binary, 300 KB–1 MB each; BLOBs would bloat WAL checkpoints, backups and exports |
| Barcode→product cache | **MMKV** | A key-value cache with no relational queries; a table would buy nothing |
| Preferences, data catalog | **MMKV** | Small key-value, no schema |

**Rule of thumb applied here:** a separate table earns its place only when queries **cross** its rows (aggregate, filter, sort, join). A 1:N relationship that is only ever read *by parent* — receipt images, for instance — is inert and belongs in a column.

**Deliberately not built in v1:** a `merchants` alias table (§4.8), a `parse_corrections` corpus (§4.10), a `product_cache` table. Each solves a problem worth solving later; none is needed to ship.

### 4.3 Storage conventions *(binding on all tables)*

| Concern | Rule |
|---|---|
| Money | **Integer cents only.** No REAL, ever — floating-point money produces cent drift that breaks the sum checks in §5.5 |
| Quantities | `REAL` (weighed goods are genuinely fractional: 0.605 kg) |
| Purchase date | `purchased_at TEXT 'YYYY-MM-DD'` — **local calendar date as printed on the receipt**, never timezone-converted |
| Purchase time | `purchased_time TEXT 'HH:MM'`, nullable — several receipts print it; keeping it separate leaves date grouping (§14.6) trivial |
| Record timestamps | `created_at` / `updated_at` — ISO-8601 **UTC** |
| Booleans | `INTEGER` 0/1 with a `CHECK` constraint |
| Closed vocabularies | Enforced by `CHECK` constraints, not convention (§4.7) |
| NULL semantics | NULL = "unknown/not printed". It never means zero — `price_cents IS NULL` is an illegible price, `= 0` is a free item |
| Column order | Large TEXT columns last, so list queries don't drag them through the page cache |

### 4.4 Schema (v1, ledger scope) — three tables

```sql
-- ---------- bills -------------------------------------------------------
CREATE TABLE bills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant        TEXT,                       -- as printed, cleaned
  merchant_norm   TEXT COLLATE NOCASE,        -- normalised, for grouping (§4.8)
  merchant_address TEXT,                      -- printed store address, as-is (§4.14)
  purchased_at    TEXT NOT NULL,              -- 'YYYY-MM-DD' (local, as printed)
  purchased_time  TEXT,                       -- 'HH:MM' or NULL
  total_cents     INTEGER,                    -- printed TOTAL, GST-inclusive
  discount_cents  INTEGER NOT NULL DEFAULT 0, -- unattached promo deductions
  currency        TEXT NOT NULL DEFAULT 'NZD',
  units_sold      INTEGER,                    -- printed scan-unit count, if any
  source          TEXT NOT NULL
                  CHECK (source IN ('manual','receipt','barcode')),
  capture_path    TEXT
                  CHECK (capture_path IN ('scanner','camera','gallery')),
  page_count      INTEGER NOT NULL DEFAULT 0, -- receipt images on disk (§4.5)
  model_alias     TEXT,                       -- which model parsed it
  created_at      TEXT NOT NULL,              -- ISO-8601 UTC
  updated_at      TEXT NOT NULL,
  parse_flags     TEXT                        -- JSON array, e.g.
                                              -- ["sum_mismatch","low_confidence"]
);

-- ---------- line items --------------------------------------------------
CREATE TABLE bill_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id         INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,           -- printed order; display + audit
  name            TEXT NOT NULL,              -- English, normalised
  name_local      TEXT,                       -- non-English name as printed
  category        TEXT NOT NULL CHECK (category IN
                    ('produce','dairy','meat','bakery','snacks','frozen',
                     'pantry_staple','beverage','household','other')),
  is_food         INTEGER NOT NULL DEFAULT 1 CHECK (is_food IN (0,1)),
  qty             REAL    NOT NULL DEFAULT 1, -- consumable quantity
  unit            TEXT    NOT NULL DEFAULT 'pc'
                  CHECK (unit IN ('pc','kg','g','l','ml','pack')),
  scan_units      INTEGER NOT NULL DEFAULT 1, -- till-counted units (§4.9)
  price_cents     INTEGER,                    -- NULL = illegible
  unit_price_cents INTEGER,                   -- cents per `unit`, e.g. 499 = $4.99/kg
                                              -- (weighed/measured items only, §4.9)
  barcode         TEXT,
  confidence      TEXT CHECK (confidence IN ('high','low')),
  user_corrected  INTEGER NOT NULL DEFAULT 0 CHECK (user_corrected IN (0,1)),
  raw_text        TEXT                        -- verbatim OCR, audit trail (cold)
);

-- ---------- cached OCR text (cold; enables re-parse without re-scan) -----
CREATE TABLE receipt_scans (
  bill_id   INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  page_no   INTEGER NOT NULL,                 -- 1-based, capture order
  ocr_text  TEXT NOT NULL,
  PRIMARY KEY (bill_id, page_no)
);

-- ---------- local telemetry (no content, §15.3) -------------------------
CREATE TABLE query_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  route         TEXT NOT NULL CHECK (route IN ('fastpath','agent')),
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  model_alias   TEXT,
  latency_ms    INTEGER,
  error_code    TEXT,                         -- hub code (§13.6) when relevant
  outcome       TEXT CHECK (outcome IN ('ok','retry','fallback','error')),
  tool_calls    TEXT                          -- JSON summary, no values
);

-- ---------- indexes -----------------------------------------------------
CREATE INDEX idx_bills_date      ON bills(purchased_at);
CREATE INDEX idx_bills_merchant  ON bills(merchant_norm);
CREATE INDEX idx_items_bill      ON bill_items(bill_id, line_no);
CREATE INDEX idx_items_cat_bill  ON bill_items(category, bill_id);
CREATE INDEX idx_items_barcode   ON bill_items(barcode)
                                    WHERE barcode IS NOT NULL;
```

**Why `bills` and `bill_items` stay separate** (the one split that pays for itself): a receipt carries facts that are not item facts — printed total, merchant, date, `units_sold`, `discount_cents`, parse flags. Flattening them would repeat those on every row, which (a) turns "spend in June" into a `SELECT DISTINCT` subquery to avoid counting one total seven times, (b) makes a date correction an N-row update that can leave one receipt holding two dates, and (c) leaves no place for an itemless bill — originally meant for manual entry ("$45 at the supermarket, don't itemise"), and since v2.7 also produced by `parse_receipt` itself for a captured receipt that isn't a goods purchase at all (§5.1). At this scale the join is microseconds on an indexed key.

### 4.5 Receipt images — files, not rows

Images live on app-private storage under a path derived by convention:

```
<app-private>/receipts/{bill_id}/{page_no}.jpg      // page_no is 1-based
```

`bills.page_count` records how many exist; paths are computed, never stored, so they cannot go stale. No table is needed because no query ever crosses image rows — they are read only by their own bill, deleted only with it.

**Handling:** excluded from the default export (§15.1) because they contain card digits, cashier names and addresses; included only via the explicit "with images" ZIP. Delete-all removes the whole `receipts/` directory. Orphan sweep on app start: directories whose `bill_id` no longer exists are deleted.

### 4.6 Why `receipt_scans` *is* a table

It is a hot/cold split, not a parent/child one. Cached OCR text is a few KB per page and read almost never — but it lets a receipt be **re-parsed with an improved prompt without re-scanning the paper**, which matters on a project already at prompt v3 and dealing with receipts the user no longer physically has. Keeping it out of `bills` stops the ledger list from paging that text in on every scroll.

If OCR caching is cut for scope, this table goes with it.

### 4.7 Closed vocabularies
| Field | Values |
|---|---|
| `category` | `produce · dairy · meat · bakery · snacks · frozen · pantry_staple · beverage · household · other` |
| `unit` | `pc · kg · g · l · ml · pack` |
| `source` | `manual · receipt · barcode` |
| `capture_path` | `scanner · camera · gallery` (NULL for manual) |

Single source of truth for the parsing prompt, the query validator (§14.5), the data catalog (§6.3) and UI filters. **Enforced by `CHECK` constraints** so a bad write fails loudly instead of silently corrupting analytics. Changing a vocabulary requires a migration *and* a prompt update in the same commit.

### 4.8 Merchant normalisation
`merchant_norm` = lowercase, trimmed, punctuation and repeated spaces collapsed, branch detail retained (`"PAK'nSAVE Mill Street"` → `paknsave mill street`). Deterministic, pure, unit-tested — it drives both grouping and the catalog's `merchants_top`.

Known limitation: OCR variation can yield two norms for one shop. v1 accepts this; the mitigation is editing the merchant on the bill detail screen. A `merchant_aliases` table is the v2 fix — do not build it now.

### 4.9 `qty` vs `scan_units` — two different counts

Receipts print a **scan-unit** count ("7 BALANCE DUE", "Total units sold: 5", "7Items") that is neither the line count nor the consumable quantity:

| Line | `qty` / `unit` | `scan_units` |
|---|---|---|
| `SPAGHETTI MEAL 2 @ $6.99` | 2 pc | **2** |
| `CROISSANTS LARGE 3PK` | 3 pc | **1** (one pack scanned) |
| `WL8号走地鸡蛋10个装` | 10 pc | **1** |
| `BANANAS 0.670 Kg` | 0.67 kg | **1** |

`qty` answers "how much food"; `scan_units` answers "what the till counted". Verified against all five corpus receipts. The integrity check is `Σ scan_units == bills.units_sold`, **not** the item count — v2.1 of the parsing prompt got this wrong and would have flagged every multibuy receipt.

**`unit_price_cents` — only for lines the till itself weighed or measured.** `BANANAS 0.670 Kg @ $3.65/Kg` prints a per-unit rate; that rate is stored as `bill_items.unit_price_cents` (`365`), giving the §5.5 #6 sanity check (`qty × rate ≈ price`) an actual `rate` to check against — the field that check always implied but the pre-v2.5 schema had nowhere to put.

Do **not** confuse this with a pre-packed item whose *name* happens to mention a weight (`Nice Marshmallows 250g`, `Wang Buckwheat Noodle 300G`). If the receipt line itself never computed the price from a printed `@ $X/unit` rate, the weight is packaging information, not a measured quantity: `qty: 1`, `unit: 'pack'`, `unit_price_cents: NULL`. Conflating these two was a real accuracy bug caught in the Python prototype — before the parsing prompt drew this distinction explicitly, ~30% of `unit`/`qty` fields on packaged snack items were wrong (the model read "250g" off the label as a measured weight). See `prompts/receipt_parse_*.md`, "packaged vs weighed", for the prompt rule that fixed it.

### 4.10 Search
Item search uses `LIKE '%term%'` over **both `name` and `name_local`**, so `豆腐干` and `dried tofu` both match. At the expected scale (thousands of rows) the scan is well inside the §8.4 budget, and substring matching avoids the word-segmentation problems a standard tokeniser has with Chinese. If it ever gets slow, the upgrade is an FTS5 virtual table with the **trigram** tokeniser — not needed for v1.

### 4.11 Integrity checks *(repository layer, on write)*
Computed at save time and recorded in `bills.parse_flags` — never silently corrected:
- `Σ price_cents + discount_cents` vs `total_cents` (±5 c) → `sum_mismatch`
- `Σ scan_units` vs `units_sold` → `unit_mismatch`
- any item `confidence = 'low'` → `low_confidence`
- any `price_cents IS NULL` → `missing_price`

Flags drive the review-screen banner (§5.6) and let a later query surface "receipts worth re-checking".

**Correction capture (v2):** when a user edits a parsed field, the pre-edit value is currently discarded — only the `user_corrected` flag survives. A `parse_corrections` table (old value, new value, `raw_text`) would turn every user fix into prompt-improvement data. Worth building once the app has real users; not needed to ship.

### 4.12 Migrations
Numbered SQL files applied inside a transaction; the `user_version` PRAGMA tracks the applied version, and `schema_version` in exports (§15.1) is the same number. **Never edit a shipped migration** — always add a new one. The runner is unit-tested against a fixture database from the previous version.

### 4.13 Pantry hook (not built in v1)
`bill_items.id` is reserved as the future target of `inventory_items.bill_item_id`, kept as a **soft reference** (nullable, resolved in the repository layer, not an enforced FK). No v1 code depends on it; it exists so v2 needs no restructuring.

### 4.14 Merchant address (navigation)
`bills.merchant_address` is the store's street address **exactly as printed** on the receipt header (`"17 Mill Street, Hamilton"`) — a text string, not a geocoded coordinate. It is intentionally left unresolved: passing the printed text straight to the platform maps intent/URL scheme (`geo:` **[A]** / Apple Maps URL scheme **[i]**) lets the OS's own search-and-navigate handle abbreviation, misspelling and disambiguation, and it costs no geocoding API call, no key, and no network round-trip at parse time. `NULL` when the receipt prints no address (common on faded thermal receipts) — the bill detail screen's "navigate" action simply doesn't render in that case, same pattern as any other optional field.

If a future version needs a pin on a map rather than a "navigate to" action, geocode **on demand when the user opens the map view**, not at parse time — geocoding every receipt on capture would be a persistent network dependency and a recurring cost for a feature most bills never use.

---

## 5. Capture module *(Weeks 5–6 — shared, one platform note)*

### 5.1 Flow
```
Document scanner (primary)  ─┐
Plain camera  (fallback)     ├→ flattened image → downscale & compress
Gallery import (fallback)   ─┘        → ML Kit OCR (blocks + frames)
   → geometry correction (§5.3) → line reconstruction (§5.4) → raw text
   → parse_receipt tool (LLM) → JSON → post-checks (§5.5)
   → Review screen → user confirms → DB write (single transaction)
```

**Not every captured receipt is a goods purchase.** `parse_receipt` itemizes
line items only for a purchase of physical goods taken home — a
supermarket, chemist, clothing or hardware store, anywhere with a per-line
price for something in the bag. A restaurant/cafe bill, a bar tab, or a
service invoice (haircut, repair, subscription) has nothing to itemize
honestly: a dish or a service has no consumable quantity and no fair
`category` fit. For these the tool returns an **itemless bill** —
`merchant`, `purchased_at`, `total_cents` populated as normal, zero line
items — rather than declining the receipt outright. The payment is still
real data worth recording even though there's nothing under it to break
into lines (§4.4 rationale).

### 5.2 Capture paths
**Primary — system document scanner.** Use the platform's native document scanner (VisionKit **[i]** / ML Kit Document Scanner **[A]**) through a single wrapper API. It provides edge detection, auto-capture, **perspective correction**, and multi-page capture before OCR runs. Multi-page matters here: long supermarket receipts that don't fit one frame become a two-page scan whose pages are concatenated in order before parsing.

**Fallbacks — must both exist:**
- **Plain camera** (`expo-camera`) — required because **[A]** the ML Kit Document Scanner depends on Google Play Services and is unavailable on devices without it. Detect availability at runtime and switch silently.
- **Gallery import** — the system scanner is camera-only, so already-taken photos always take the fallback path.

**Common to all paths:**
- Long edge ≤ 2000 px, JPEG q≈85; larger inputs cost time without accuracy gains.
- Persist the resulting image to app storage; images written to `receipts/{bill_id}/{page}.jpg` and `page_count` updated (§4.5); OCR text cached in `receipt_scans` (§4.6).
- Fallback paths show overlay guidance: fill the frame, flatten the receipt, avoid shadow.
- Record which path produced the image; `query_log`-style telemetry on scanner-vs-fallback parse quality tells you whether the fallback needs work.

> **Note on scanner UI.** The scanner is *system-provided*, so it looks and behaves differently on each platform. That is acceptable and even desirable — it is native UI the user already recognises — but it means the capture screen cannot be pixel-unified across platforms, and E2E tests must handle two different scanner UIs.

### 5.3 Geometry correction
Two distinct problems, handled at different layers:

1. **Perspective distortion** (receipt photographed at an angle → trapezoid). This is what produced the merged-row failures in the Python prototype, and rotation alone cannot fix it. On the primary path the **system scanner corrects it before OCR** — this is the main reason to prefer it.
2. **Residual rotation** on fallback paths. Compute the median rotation angle from ML Kit's text-block corner points and apply a 2-D rotation to the **box coordinates** (not the bitmap) before grouping. Cheap, deterministic, unit-testable against saved fixture boxes, identical on both platforms.

**Keep both.** Step 2 is not obsolete: it still serves gallery imports, no-Play-Services devices, and any residual skew the scanner leaves behind.

### 5.4 Line reconstruction *(port of the validated Python logic)*
1. Reduce each recognised element to `{x, yCenter, w, h, text}`.
2. `medianHeight` = median of `h`.
3. Sort by `yCenter`; start a new line when `|Δ yCenter| > 0.6 × medianHeight`.
4. Within a line, sort by `x`; insert a wide-gap marker when `gap > 2.5 × averageCharWidth` (preserves the price column).

Thresholds live in one config object, tuned against the fixture corpus.

> **Cross-platform check (Wk 5):** ML Kit's block/line granularity can differ subtly between platforms. Run the same fixture receipts through both and compare reconstructed text; if granularity differs, the thresholds — not the algorithm — are what need adjusting.

### 5.5 Post-checks *(code, not prompt)*
Run before the review screen; each failure sets a flag rather than blocking:
1. JSON schema/type/enum validation → one retry with the error message → then fall back to manual entry.
2. Sum check: `|Σ items + discounts − total| ≤ 5 cents` → else flag `sum_mismatch`.
3. `units_sold` vs item count when present.
4. GTIN check-digit validation → invalid ⇒ `barcode = null`, `confidence = 'low'`.
5. Valid barcode ⇒ Open Food Facts lookup (results cached in MMKV, §4.2 — so repeat purchases and offline scans resolve without a network call); a hit overrides the model's name/category, but never `name_local`.
6. Weighed-item sanity: `qty × unit_price_cents ≈ price_cents`, where printed (§4.9).

**Itemless bills skip checks 2–3 entirely** rather than running them against
an empty item list — summing zero items against a real printed total is not
a `sum_mismatch`, it's the expected shape of a receipt the model correctly
declined to itemize (§5.1). Checks 1, 4–6 don't apply to an empty item list
either way, so nothing special is needed for them.

### 5.6 Review screen (the trust gate)
- High-confidence rows pre-checked; `confidence='low'` rows highlighted and focused first.
- Inline editing of name, category, qty, price; original `raw_text` shown as secondary text.
- Any edit sets `user_corrected = 1` — the corpus for prompt improvement.
- Receipt-level warnings ("items don't add up to the total") as a dismissible banner.
- **Itemless bills show no item list** — just merchant, date and total, with an
  affordance to itemize manually if the user disagrees with the model's call
  (turning it into a normal itemized bill is then no different from manual entry).
- **Nothing is written to the database before explicit confirmation.**

### 5.7 Acceptance criteria
- 10-item receipt: capture → review screen in **≤ 6 s** on the mid-tier Android device and on the oldest supported iPhone.
- Fixture corpus: ≥ 90% of line items correct without edits; **100%** of receipts either parse or fall back cleanly to manual entry (no crash, no silent partial save).
- All three capture paths (scanner, plain camera, gallery) reach the review screen successfully on both platforms.
- Scanner unavailability **[A]** is detected at runtime and falls back without an error dialog.

**What "correct" is measured against.** The fixture corpus's expected JSON
is built by whoever curates it (human QA, or an AI assistant reading the
same receipt images the parser reads — the Python prototype used the
latter; see its `CLAUDE.md`) — not an independent oracle. Two checks are
genuinely non-AI and catch real transcription errors regardless of who read
the receipt: GTIN check-digit validation on barcodes, and arithmetic
reconciliation (`qty × rate ≈ price`, `Σ items ≈ total`, §4.9/§5.5). Neither
helps on `category` (not printed on the receipt at all — pure
interpretation, no anchor either way) or on a glyph the curator and the
parser happen to misread the same way. Read the 90% figure as "agrees with
a careful independent reading, math permitting," not as validated truth —
and where the curator was an AI assistant, budget time for a human to spot-
check the corpus against the physical receipts at least once.

**The OCR-then-LLM path this section actually specifies has now been
tested, not just assumed.** The Python prototype ran its OCR-text path
(mirroring this exact §5.1 flow, `parse_receipt` fed reconstructed text
rather than an image) against the eleven-receipt corpus and scored ~96.3%
mean field accuracy, versus ~97.5% for a direct-image reference parse of
the same receipts — a real but narrow ~1.2-point gap once the recognition-
language gap above was fixed (it read ~4.2 points wider with that bug
still in, which is its own lesson: verify what the OCR step actually
captured before trusting an end-to-end accuracy number built on top of
it). The one specific, repeatable weakness found: **discount-to-item
attribution**, when a receipt prints two discounts near each other and the
line-reconstruction step (§5.4) doesn't preserve which discount sat under
which item — obvious from a photo, genuinely ambiguous once flattened to
text. Worth a dedicated post-check (§5.5) or review-screen emphasis (§5.6)
on any bill with more than one discount line, rather than trusting the
model to always disambiguate it from text alone.

## 6. Agent module *(Weeks 7–8 — fully shared)*

### 6.1 Orchestrator loop
```
assemble prompt → POST /v1/chat (stream)   # contract: §13.2
  ├─ tool_call → validate args → execute locally → append result → repeat (max 8)
  └─ final     → parse AnswerEnvelope → render
network error → fastpath if the pattern matches, else offline notice
loop cap hit  → partial answer ("here's what I found so far")
```
Every turn writes a `query_log` row.

### 6.2 ⚠️ Streaming in React Native
RN's global `fetch` (XHR-backed) **does not expose a readable stream**, so a naive port of web streaming code silently buffers the whole response. Use `expo/fetch`'s streaming-capable API, or `react-native-sse`.

**Verify on physical hardware on both platforms in Week 7** — emulator/simulator networking behaves differently from real devices, and iOS and Android use different underlying network stacks. If streaming proves unstable on either platform, degrade to non-streaming requests with a typing indicator; **correctness must never depend on streaming.**

### 6.3 Prompt assembly
```
[system prompt][tool schemas]        ← static, byte-identical (prefix cache)
[data catalog]                       ← per conversation
[history: last 6 turns]
[user message]
```
Data catalog (~100 tokens, cached in MMKV, invalidated on bill write):
```json
{"categories":[...], "merchants_top":[...],
 "data_range":{"first_bill":"2026-02-03","last_bill":"2026-07-19"},
 "currency":"NZD","bill_count":142}
```

### 6.4 Tools (v1 set) — *full schemas in §14*
| Tool | Access | Confirmation |
|---|---|---|
| `query_ledger` | read-only | no |
| `get_bill_detail` | read-only | no |
| `update_bill_item` | write | **yes** |
| `delete_bill` | write | **yes** |

Write tools return `{"status":"pending_user_confirmation"}` to the model and end the loop; the UI renders a confirmation card and commits locally on tap — no second LLM call.

### 6.5 Query spec → SQL
The model **never emits SQL**. It emits a constrained spec; `compile.ts` is the only module that knows table and column names, and it emits **parameterized** queries from hand-written templates.

Validation order: unknown key → reject · enum mismatch → reject · `limit` clamped to ≤ 50 · date range clamped to available data · filter values need not exist (an empty result is a valid answer). The rejection message is returned to the model as the tool result for its single retry.

### 6.6 Fastpaths (~15 patterns — zero cost, offline)
`total this month` · `spend on <category> [period]` · `last N bills` · `biggest bill` · `spend at <merchant>` · `this month vs last month` · … Matched by regex plus a small date-phrase parser **before** any network call. Target **< 100 ms**.

### 6.7 Answer envelope & rendering — *full schema in §14.7*
```json
{"text":"…","render":{"type":"bar|line|donut|table|stat|none", "...":"..."},
 "pending_actions":[…], "followups":["…"]}
```
The renderer enforces sanity: donut only with ≤ 8 slices (else bar), tables paginated beyond 50 rows, numbers formatted to device locale and currency. An unparseable envelope falls back to showing the model's text only — never a crash.

### 6.8 Acceptance criteria
- Fastpath p95 < 100 ms; agent p50 < 4 s to first token on mobile data, **measured on both platforms**.
- 100% of malformed/adversarial specs in the test suite rejected before reaching SQL.
- No write ever commits without an explicit user tap.

---

## 7. UI & navigation *(shared, with platform-idiomatic details)*

| Screen | Purpose |
|---|---|
| Ledger (tab) | Reverse-chronological bills, search, month header totals, capture action |
| Ask (tab) | Chat: messages, inline charts/tables, followup chips, confirmation cards |
| Insights (tab) | Category and merchant breakdowns, month-over-month trend |
| Capture / Review | §5 |
| Bill detail | Items, edit, receipt image, delete, navigate to merchant (§4.14, when `merchant_address` is present) |
| Settings | Usage & quota (§13.3), active model (§13.4), BYOK, export (§15.1), delete-all (§15.2) |

**Shared requirements:** dark mode; text sized in scalable units honouring the system font scale; accessibility labels on every interactive element; an empty state on every list explaining the next action; currency and dates via `Intl` with the device locale.

**Platform-idiomatic details** — deliberately *not* unified:
| Aspect | **[A]** Android | **[i]** iOS |
|---|---|---|
| Design language | Material 3, dynamic colour where available | iOS-native feel; standard system spacing |
| Primary action | Floating action button | Header action / bottom-anchored button |
| Back navigation | System back button **must** be handled everywhere | Swipe-back gesture must not be broken by custom gestures |
| Screen reader | TalkBack verification | VoiceOver verification |
| Safe areas | Status/nav bar insets | Notch / Dynamic Island / home indicator insets |

> Using a single generic look on both platforms is acceptable for v1, but back-gesture handling and safe-area insets are **not** optional — they are the two most common cross-platform defects.

---

## 8. Platform concerns

### 8.1 Permissions
| Capability | **[A]** Android | **[i]** iOS |
|---|---|---|
| Camera | `CAMERA`, runtime request at first capture | `NSCameraUsageDescription` — **a specific purpose string is mandatory** |
| Photo import | System photo picker, no storage permission | `NSPhotoLibraryUsageDescription`; prefer limited-access picker |
| Notifications (v2) | `POST_NOTIFICATIONS` runtime on Android 13+ | Runtime request, always |

Shared rule: request permission **at the moment of use** with a plain-language rationale, and keep the app fully usable via manual entry if it is denied.

### 8.2 Security & privacy
**Shared**
- No API keys in the app binary. The device attests → the hub issues a scoped token → stored via `expo-secure-store`.
- Attestation failure (rooted/jailbroken device, emulator) **soft-fails to BYOK-only mode** rather than bricking the app.
- No cleartext traffic; release builds minified/optimised.
- In-app export and delete-all, so the user is never locked in.

**[A] Android**
- **`android:allowBackup="false"`** and no data-extraction rules — otherwise the ledger database is silently synced to Google's auto-backup, contradicting the core privacy claim.
- Optional Settings toggle: `FLAG_SECURE` to block screenshots and the recents-screen preview.
- Attestation: Play Integrity.

**[i] iOS**
- **Exclude the database file from iCloud backup** (`isExcludedFromBackup`) — the direct equivalent of the Android setting above, and equally easy to forget. Same privacy stake.
- No `FLAG_SECURE` equivalent exists; document the gap rather than faking it.
- Attestation: App Attest. **Its entitlement is unavailable under personal-team signing**, so during development `platform/attestation.ios.ts` returns "unattested" and the app runs in BYOK mode. Write the real implementation behind the same interface; the soft-fail path above makes this a configuration difference, not a code fork.
- App Privacy details must match the Android data-safety declaration (§9).

### 8.3 Background & lifecycle
v1 has **no background work**. When reminders arrive in v2, use **schedule-ahead local notifications at write time** rather than a polling job — reliable on both platforms, and cheaper.

**State restoration is mandatory:** both platforms may terminate the app while the camera is open. Persist in-progress parse results to MMKV and restore on relaunch. **[A]** memory pressure on low-end devices is the usual trigger; **[i]** backgrounding during capture is.

### 8.4 Performance budgets
| Metric | Target |
|---|---|
| Cold start to interactive | < 2.0 s (mid-tier Android; oldest supported iPhone) |
| Ledger list scroll | 60 fps with 500+ bills |
| OCR (capture → raw text) | < 1.5 s |
| Fastpath query | < 100 ms |
| Release size | **[A]** < 45 MB · **[i]** < 60 MB download |

---

## 9. Deployment

### 9.1 Shared
- **Builds:** EAS Build, profiles `development` / `preview` / `production`, producing both platforms from the same commit.
- **Versioning:** one semantic `version` shared by both platforms; build numbers (`versionCode` **[A]**, `buildNumber` **[i]**) auto-incremented.
- **Hub:** Cloudflare Worker via Wrangler, separate `dev` and `prod` environments; contract in §13. The model alias map is Worker config, so the model can change without any app release — on either platform.
- **Privacy declarations must agree.** The Play data-safety form and the App Store privacy details describe the same behaviour: financial records stay on-device; question text and minimal aggregates are sent to the named AI provider for processing.

### 9.2 Android **[A]**
- Play App Signing; upload key held in EAS credentials, never in the repository.
- Tracks: internal → closed beta → production.
- Data-safety form and privacy-policy URL required.

### 9.3 iOS **[i]**
- **Development/testing distribution:** local Xcode build installed directly on the test device under personal-team signing, with Developer Mode enabled (§1.2). Re-sign roughly weekly as the profile expires.
- **Store distribution** (post-project): hosted builds and beta channel become available once store credentials exist; nothing in the codebase changes — only signing configuration.
- **Build requirements that affect code, not paperwork:** every permission needs a specific purpose string (§8.1); the app must remain functional when camera access is denied (satisfied by manual entry); privacy declarations must match actual behaviour (§9.1).

---

## 10. Testing

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Jest | Query compiler & validator, line reconstruction, rotation/geometry maths, date parsing, GTIN check digit, sum checks, category rules, migrations |
| Fixtures | Jest snapshots | **Receipt corpus**: saved OCR text + expected JSON, including the Warehouse case (barcodes, two-line items), New World case (weighed item, GST-exclusive SUB TOTAL trap), and a restaurant-bill case (§5.1) covering the itemless path; grows with every reported mis-parse. See §5.7 for what "expected" is actually checked against |
| Adversarial | Jest | Malformed specs, unknown enums, oversized limits, injection-shaped strings, empty results — all rejected or handled without touching SQL |
| Integration | Jest + in-memory SQLite | Repository ↔ DB, transaction rollback on failed receipt write |
| E2E | Maestro | capture→review→save · ask→chart · edit-with-confirmation · permission denied · airplane mode. **Run the same flows on both platforms** |
| Device | Manual matrix (§1.3) | Camera, permissions, fonts/scaling, dark mode, safe areas, **[A]** system back button, **[i]** swipe-back gesture, low-memory behaviour |
| Non-functional | Manual + `query_log` | Performance budgets (§8.4), token usage per turn, offline degradation |

**Cross-platform test rule:** a feature is not "done" until its E2E flow passes on **both** platforms. Platform-specific bugs found late are the main schedule risk in a cross-platform project; catching them per-feature keeps them cheap.

**CI:** every PR runs typecheck, lint, unit + integration tests. Merges to `main` trigger `preview` builds for both platforms.

**Definition of done (per feature):** tests pass · no new TypeScript errors · works offline or degrades with a clear message · accessibility labels present · **verified on one physical Android device and one physical iPhone**.

---

## 11. Week-by-week engineering plan (Weeks 3–10)

| Wk | Deliverable | Done when |
|---|---|---|
| **3** | Project scaffold (both platforms building), DB + migrations, repositories, manual entry, bill list/edit/delete | A manual bill survives restart on both platforms; migration test passes; `expo prebuild` produces working iOS and Android projects |
| **4** | Insights: category/merchant/period summaries; app shell, theming, dark mode, safe areas | Charts render real data on both platforms; empty states present; no layout clipping on notch devices |
| **5** | Document scanner + camera/gallery fallbacks, ML Kit OCR, barcode, geometry correction + line reconstruction → raw text | All three capture paths work on both platforms; prototype fixtures reproduce on-device within tolerance (§5.4 check) |
| **6** | Hub-backed `parse_receipt`, post-checks, review screen, transactional save | Both sample receipts parse end-to-end; corrections persist |
| **7** | Hub deployed (§13); agent loop, streaming, `query_ledger` + validator + compiler (§14); **attestation on both platforms** | Adversarial spec suite 100% rejected; streaming verified on physical Android **and** iPhone (§6.2) |
| **8** | Envelope rendering (text/table/chart), fastpaths, followups, confirmation cards | Fastpath < 100 ms; no write without a tap |
| **9** | Hardening: export/delete-all (§15), offline paths, perf/cost tuning, accessibility (TalkBack + VoiceOver), back-gesture and safe-area pass, bug bash, (optional) voice input | Budgets in §8.4 met on both platforms |
| **10** | Full device matrix, E2E green on both, store assets, privacy declarations, **beta release: Play internal testing (Android) + direct device install (iOS)** | Android build live on internal testing; iOS build running on the test device |

**Risk buffer:** Week 9 is the shock absorber. If Weeks 5–8 slip, drop voice input first, then reduce chart types to bar + table, then trim fastpaths to the top 5. Capture, storage, and correct answers are non-negotiable.

**If the schedule compresses:** ship Android to beta in Week 10 and let iOS follow shortly after. Because the codebase is shared, the iOS remainder is store logistics and device testing — not re-implementation. Do **not** respond to pressure by deferring iOS work to a "port later" phase; the cross-platform cost is low only while it stays continuous.

---

## 12. Open items to resolve during Week 3

1. **[A] done, [i] still open.** Both ML Kit packages
   (`@react-native-ml-kit/text-recognition`, `@react-native-ml-kit/barcode-scanning`)
   were flagged "untested on New Architecture" by React Native Directory —
   metadata, not a live test. Actually ran a debug build
   (`expo prebuild --platform android` → `./gradlew assembleDebug`, RN
   0.86.2, Fabric/TurboModules on): both compiled, linked, and produced a
   working APK. **Real gotcha hit along the way**: the build failed first
   under JDK 26 (the system default here) with a `jlink`/`androidJdkImage`
   transform error against `android-36`'s `core-for-system-modules.jar` —
   and that failure hit `react-native-svg` and `react-native-masked-view`
   too, i.e. it was a JDK-toolchain problem, not a New Architecture one.
   Switching to **JDK 17** (Temurin) fixed it outright. Pin the Android
   build JDK to 17 in CI and document it for local setup — don't assume
   whatever JDK is newest/pre-installed will work with the current AGP.
   iOS side (App Attest, VisionKit, ML Kit's iOS pod) still needs the same
   real-build treatment; Xcode/Simulator wasn't available where this was
   tested from.
2. Confirm the current Play `targetSdkVersion` requirement and the minimum iOS version against current store policy.
3. Choose the chart library after a spike (Skia dependency vs feature set), verified on both platforms.
4. Verify `expo/fetch` streaming on a physical device on each platform (§6.2).
5. Decide the home-screen launcher label — "YourIntelliLedger" truncates on both platforms; suggested: `IntelliLedger`.
6. Fix the free-tier quota (units/month) for the hub and the BYOK unlock behaviour.

---

## 13. Hub API contract

The hub is a **stateless** Cloudflare Worker: the only component the app talks to besides Open Food Facts. It exists to hold the gateway key (which must never ship in the app), meter usage, and map model aliases. It stores no message content.

**Base URLs:** `https://hub-dev.<domain>` / `https://hub.<domain>` — selected by build profile.
**Format:** JSON request/response; `application/json` unless streaming.
**Error shape:** `{"error":{"code":"<machine_code>","message":"<human text>"}}`

### 13.1 `POST /v1/attest` — obtain a device token

```jsonc
// request
{"platform":"android|ios",
 "attestation":"<Play Integrity token | App Attest assertion>",
 "app_version":"1.0.0"}

// 200
{"device_token":"<JWT>",
 "expires_at":"2026-08-20T00:00:00Z",
 "attested":true,
 "quota":{"period":"month","limit_units":N,"used_units":0,"resets_at":"..."}}
```

- The hub verifies the attestation with the corresponding platform service, then issues a short-lived JWT bound to a hashed device identifier.
- **`attested:false` is a valid response**, returned when verification is unavailable or fails (emulator, rooted/jailbroken device, personal-team signing — §8.2). The client then operates in **BYOK-only** mode: it must supply `X-BYOK` on `/v1/chat` or receive `attestation_required`.
- The client re-attests on `401 token_expired`. Exactly one automatic re-attest per request; a second failure surfaces to the user.

### 13.2 `POST /v1/chat` — the only LLM endpoint

Headers: `Authorization: Bearer <device_token>` · optional `X-BYOK: <user gateway key>`

Body is an OpenAI-compatible chat-completions payload, **except `model` must be an alias** (§13.5):

```jsonc
{"model":"chat-fast","stream":true,
 "messages":[...],"tools":[...],"tool_choice":"auto"}
```

Hub behaviour, in order:
1. Validate the JWT (signature, expiry, app version ≥ `min_app_version`).
2. Reject unknown aliases → `unknown_model`.
3. If no `X-BYOK`: check quota → `quota_exceeded` if spent.
4. Resolve alias → concrete gateway model; attach the gateway key (or the BYOK key).
5. Forward to the gateway; stream the response back unmodified.
6. On completion, increment the quota counter from the usage reported in the final chunk.

Response: standard SSE stream, plus one terminal hub event before `[DONE]`:

```
event: hub_meta
data: {"quota_remaining_units":N,"model_used":"<provider/model>","usage":{"prompt_tokens":…,"completion_tokens":…}}
```

The client writes `usage` into `query_log` (§15.3). **Non-streaming (`stream:false`) must also be supported** as the fallback required by §6.2; `hub_meta` then appears as a top-level field in the JSON response.

### 13.3 `GET /v1/quota`
```json
{"period":"month","limit_units":N,"used_units":M,"resets_at":"...","byok_active":false}
```
Used by the Settings screen. Never blocks app functionality.

### 13.4 `GET /v1/config`
```json
{"aliases":{"chat-fast":"<provider/model>","parse-strong":"<provider/model>"},
 "min_app_version":"1.0.0",
 "notices":[]}
```
Cached in MMKV for 24 h. Lets Settings display the active provider (transparency, §8.2) and lets you force-upgrade broken clients without a store release.

### 13.5 Model aliases

| Alias | Used by | Rationale |
|---|---|---|
| `chat-fast` | Agent turns (§6) | Cheap tier; query translation needs no heavy reasoning |
| `parse-strong` | `parse_receipt` (§5) | Receipt errors poison the ledger; promote/demote independently based on fixture accuracy |

The **alias is the only model name the app knows**. Remapping happens in Worker config, so a provider change requires no app release on either platform. The alias allowlist also means a compromised client cannot spend the key on an arbitrary expensive model.

### 13.6 Error codes

| HTTP | `code` | Client behaviour |
|---|---|---|
| 401 | `token_expired` | Re-attest once, retry |
| 401 | `token_invalid` | Re-attest; if it fails, BYOK or offline mode |
| 403 | `attestation_required` | Prompt for BYOK key in Settings |
| 403 | `app_version_unsupported` | Blocking "please update" screen |
| 400 | `unknown_model` | Bug — log, fall back to fastpath |
| 429 | `quota_exceeded` | Explain quota; offer BYOK; fastpaths keep working |
| 429 | `rate_limited` | Exponential backoff, max 2 retries |
| 502/504 | `upstream_error` | One retry, then offline notice |

### 13.7 Invariants
- **No message content is logged**, in any environment. Only counters keyed by hashed device ID.
- Requests are forwarded byte-for-byte apart from the `model` field and auth headers.
- Persistence is limited to quota counters (KV) and a token revocation list.
- Per-token rate limit and a hard monthly ceiling per device bound worst-case spend.
- The Worker is open-sourced so the privacy claim is auditable.

---

## 14. Agent tool schemas

These schemas are the LLM contract **and** the validator whitelist. They ship in the app, so they can never drift from the database (§4). All tools are executed locally; the model only ever sees these definitions and the results.

### 14.1 `query_ledger` *(read-only)*
```json
{"name":"query_ledger",
 "description":"Read-only aggregate or list query over bills and items. Cannot modify data.",
 "parameters":{"type":"object","properties":{
   "metric":{"enum":["sum_amount","avg_amount","count","list_items","list_bills"]},
   "dimension":{"enum":["category","merchant","month","week","day","none"]},
   "filters":{"type":"array","maxItems":4,"items":{"type":"object","properties":{
      "field":{"enum":["category","merchant","name"]},
      "op":{"enum":["eq","in","contains"]},
      "value":{}},
      "required":["field","op","value"]}},
   "time_range":{"type":"object","properties":{
      "unit":{"enum":["day","week","month","year"]},
      "last":{"type":"integer","minimum":1,"maximum":36}}},
   "sort":{"enum":["amount_desc","amount_asc","date_desc","date_asc"]},
   "limit":{"type":"integer","minimum":1,"maximum":50}},
  "required":["metric"]}}
```

### 14.2 `get_bill_detail` *(read-only)*
```json
{"name":"get_bill_detail",
 "description":"Return one bill with all of its line items.",
 "parameters":{"type":"object","properties":{
   "bill_id":{"type":"integer"}},
  "required":["bill_id"]}}
```

### 14.3 `update_bill_item` *(write — confirmation required)*
```json
{"name":"update_bill_item",
 "description":"Correct a line item. Requires user confirmation before it takes effect.",
 "parameters":{"type":"object","properties":{
   "bill_item_id":{"type":"integer"},
   "set":{"type":"object","properties":{
      "name":{"type":"string","maxLength":120},
      "category":{"enum":["produce","dairy","meat","bakery","snacks","frozen",
                          "pantry_staple","beverage","household","other"]},
      "qty":{"type":"number","minimum":0},
      "unit":{"enum":["pc","kg","g","l","ml","pack"]},
      "price_cents":{"type":"integer","minimum":0}},
      "minProperties":1}},
  "required":["bill_item_id","set"]}}
```

### 14.4 `delete_bill` *(write — confirmation required)*
```json
{"name":"delete_bill",
 "description":"Delete a bill and its items. Requires user confirmation.",
 "parameters":{"type":"object","properties":{
   "bill_id":{"type":"integer"},
   "reason":{"type":"string","maxLength":200}},
  "required":["bill_id"]}}
```

### 14.5 Validation rules *(`validate.ts`, applied before any execution)*

| Check | Action on failure |
|---|---|
| Unknown property present | reject — `unknown_field` |
| Enum mismatch | reject — `invalid_enum`, message lists valid values |
| `limit` > 50 | clamp to 50 (no rejection) |
| `time_range.last` out of range | clamp, and note the clamp in the tool result |
| Time range predates the first bill | clamp to available range; the model must be told so it can say so |
| Non-existent filter *value* | **allowed** — an empty result is a legitimate answer |
| `bill_id` / `bill_item_id` not found | reject — `not_found` |
| Write tool: any validation failure | reject; never partially apply |

Rejections are returned to the model as the tool result so it can self-correct on its single retry (§6.1). A second failure ends the loop with a plain-language apology, and the turn is logged with `outcome='error'`.

### 14.6 Spec → SQL mapping *(`compile.ts` — the only module that knows column names)*

| Spec element | Compiles to |
|---|---|
| `metric: sum_amount` | `SUM(bill_items.price_cents)` **only** when `dimension` needs a `bill_items` column (`category`, or a `name`/`name_local` filter) — otherwise `SUM(bills.total_cents)` grouped/filtered at the bill level. An itemless bill (§5.1) has zero `bill_items` rows, so a plain "how much did I spend" query that joins through `bill_items` would silently exclude every itemless bill's total. Get this wrong and monthly-spend answers undercount by exactly the itemless bills. |
| `metric: count` | `COUNT(*)` |
| `metric: list_bills` | selects from `bills`, joined for totals |
| `dimension: category\|merchant` | `GROUP BY bill_items.category` / `bills.merchant_norm` |
| `dimension: month\|week\|day` | `GROUP BY strftime(...)` on `bills.purchased_at` |
| `filters[].op: eq\|in\|contains` | `= ?` / `IN (?,…)` / `LIKE '%'\|\|?\|\|'%'` — for `field:"name"` the LIKE is applied to **both `name` and `name_local`** (§4.7), so `豆腐干` matches |
| `time_range` | `purchased_at BETWEEN ? AND ?` (computed app-side, never by the model) |
| `limit` | `LIMIT ?` |

**All values are bound parameters.** String interpolation into SQL is prohibited anywhere in the codebase; add a lint rule and a unit test that asserts the compiler's output contains no user-supplied literals.

### 14.7 Answer envelope *(model → client)*
```jsonc
{"text":"You spent $214 on groceries in June, 12% less than May.",
 "render":{"type":"bar",              // none|stat|table|bar|line|donut
   "title":"Grocery spend by category — June",
   "x":{"label":"Category","values":["Produce","Dairy","Meat"]},
   "series":[{"label":"NZD","values":[64.2,43.1,71.5]}]},
 "pending_actions":[{"tool":"update_bill_item","summary":"Set 'milk bottles' to snacks","ref":"a1"}],
 "followups":["Compare to last 3 months","Where did meat spend go?"]}
```

Renderer rules (client-enforced, §6.7): donut only with ≤ 8 slices, else bar · table paginated beyond 50 rows · `stat` requires a single numeric value · unknown `type` degrades to `text` · a malformed envelope renders `text` alone and logs `outcome='fallback'` — never a crash.

---

## 15. Data portability, errors & telemetry

### 15.1 Export *(Settings → Export)*
Two formats, generated on-device and shared via the platform share sheet:

- **`yourintelliledger-export-YYYY-MM-DD.json`** — complete and re-importable: schema version, all bills with nested items, and preferences. This is the backup format (it exists because auto-backup is deliberately disabled — §8.2).
- **`…-items.csv`** / **`…-bills.csv`** — flat, spreadsheet-friendly, one row per line item / per bill. Not re-importable; for the user's own analysis.

Receipt images are **not** included by default (size); an "include images" option produces a ZIP.

**Import** is v1-optional but the JSON format must be specified now so exports made today remain restorable later: `{"schema_version":1,"exported_at":"…","bills":[{…,"pages":[…],"items":[…]}],"preferences":{…}}` — items include `name_local`, `scan_units` and `unit_price_cents`; CSV exports add all three as columns.

### 15.2 Delete-all
Two-step confirmation (type-to-confirm), then in one transaction: drop all rows from `bills` (cascades to `bill_items` and `receipt_scans`), clear `query_log`, delete the `receipts/` directory (§4.5), clear MMKV caches (catalog, config), and revoke the stored device token. Preferences reset to defaults. The operation is irreversible and the UI says so plainly, offering export first.

### 15.3 Error taxonomy & telemetry

`query_log.outcome` values, and what each means:

| Value | Meaning |
|---|---|
| `ok` | Answered normally (fastpath or agent) |
| `retry` | One tool-call validation failure, then success |
| `fallback` | Degraded answer: partial result, text-only render, or fastpath used after a network failure |
| `error` | No useful answer returned to the user |

Every turn records: `route`, `latency_ms`, `tokens_in/out` (from `hub_meta`), `model_alias`, and a JSON summary of tool calls. **No question text and no financial values are stored in `query_log`** — it is diagnostic, not a transcript.

Telemetry is **local-only by default**. Settings shows the user their own usage (requests this month, estimated tokens). Any sharing is explicit opt-in, and shares aggregates only — never receipt or query content.

**User-facing error copy** must say what happened and what still works, e.g. *"I couldn't reach the assistant. Your receipts and totals are still available offline."* Never expose raw error codes, stack traces, or model names in error messages.
