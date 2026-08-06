# src/platform

**The ONLY place platform forks are permitted** (spec §2.2 rule 3). No
`Platform.OS` branching anywhere else, except trivial cosmetics
(`Platform.select()` inline for a padding value or haptic style).

Expected shape (spec §2.1) — a shared interface plus one file per
platform, resolved automatically by the bundler so callers import the bare
path (`@/platform/attestation`) and stay unaware of the fork:

```
attestation.ts        # shared interface + types
attestation.android.ts  # Play Integrity
attestation.ios.ts      # App Attest
privacy.ts             # interface
privacy.android.ts      # allowBackup=false, FLAG_SECURE
privacy.ios.ts          # exclude DB from iCloud backup
```

Any new native capability gets a shared interface **first**, then
per-platform implementations (spec §2.2 rule 5).
