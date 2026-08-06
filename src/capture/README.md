# src/capture

Scanner, camera, OCR, geometry correction, line reconstruction (spec §2.1,
§5). ~95% shared — the one platform note is the native document scanner
wrapper (VisionKit **[i]** / ML Kit Document Scanner **[A]**, spec §5.2).

Distinct from `src/app/capture/` (the screens) — this folder is the
business logic the screens call into, not UI.
