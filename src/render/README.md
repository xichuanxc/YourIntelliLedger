# src/render

Answer envelope → text / table / chart (spec §6.7, §14.7). 100% shared
across platforms. Enforces rendering sanity (donut only ≤ 8 slices else
bar, tables paginated beyond 50 rows) — a malformed envelope falls back to
text only, never a crash.
