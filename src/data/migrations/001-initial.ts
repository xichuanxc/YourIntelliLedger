import type { Migration } from '@/data/migrations/types';

/**
 * Schema v1, ledger scope — spec §4.4.
 *
 * SHIPPED. Never edit this file: a device that has already applied version 1
 * will not re-run it, so an edit here produces two different "version 1"
 * schemas in the wild. Changes go in a new numbered migration (§4.12).
 *
 * The `CHECK` constraints are not decoration — they are how a closed
 * vocabulary (§4.7) fails loudly at the write instead of quietly corrupting
 * analytics months later.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial ledger schema',
  sql: `
    -- ---------- bills ---------------------------------------------------
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

    -- ---------- line items ----------------------------------------------
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
      unit_price_cents INTEGER,                   -- cents per \`unit\`, e.g. 499 = $4.99/kg
                                                  -- (weighed/measured items only, §4.9)
      barcode         TEXT,
      confidence      TEXT CHECK (confidence IN ('high','low')),
      user_corrected  INTEGER NOT NULL DEFAULT 0 CHECK (user_corrected IN (0,1)),
      raw_text        TEXT                        -- verbatim OCR, audit trail (cold)
    );

    -- ---------- cached OCR text (cold; enables re-parse without re-scan) --
    CREATE TABLE receipt_scans (
      bill_id   INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      page_no   INTEGER NOT NULL,                 -- 1-based, capture order
      ocr_text  TEXT NOT NULL,
      PRIMARY KEY (bill_id, page_no)
    );

    -- ---------- local telemetry (no content, §15.3) ----------------------
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

    -- ---------- indexes ---------------------------------------------------
    CREATE INDEX idx_bills_date      ON bills(purchased_at);
    CREATE INDEX idx_bills_merchant  ON bills(merchant_norm);
    CREATE INDEX idx_items_bill      ON bill_items(bill_id, line_no);
    CREATE INDEX idx_items_cat_bill  ON bill_items(category, bill_id);
    CREATE INDEX idx_items_barcode   ON bill_items(barcode)
                                        WHERE barcode IS NOT NULL;
  `,
};
