# src/data

DB, migrations, repositories, and the pure helpers they rely on. 100% shared
across platforms (spec §2.1, §4).

```
driver.ts          the narrow SqlDriver interface — the only SQLite surface used above it
driver.expo.ts     expo-sqlite implementation (the app). better-sqlite3 backs the same
                   interface under test, from __tests__/support/sqlite-driver.ts
db.ts              opens once, applies the §4.1 pragmas, migrates, hands back a driver
migrate.ts         runner: one transaction per migration, tracked by `user_version`
migrations/        numbered, append-only. NEVER edit a shipped migration (§4.12)
rows.ts            raw row shapes ↔ domain types; nothing outside src/data sees a row
ledgerRepo.ts      bills and items: reads, writes, search, transactional saves
integrity.ts       the §4.11 checks — record what looks wrong, correct nothing
merchant.ts        §4.8 normalisation: deterministic, pure, unit-tested
money.ts           integer cents in, integer cents out (§4.3). No REAL money, ever
dates.ts           local calendar dates for purchases, UTC for record timestamps
errors.ts          ValidationError / NotFoundError
```

Not built yet: `insightsRepo` (Week 4), the data catalog and `prefs` (§6.3,
MMKV), and `receipt_scans` writes (Weeks 5–6). The table already exists in
migration 001, so those land without a schema change.
