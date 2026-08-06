# src/fastpath

Regex + date-phrase parsing for the ~15 zero-cost offline query patterns
(spec §6.6). 100% shared across platforms. Target p95 < 100ms, matched
before any network call to the agent loop.
