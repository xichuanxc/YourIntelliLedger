# YourIntelliLedger — mobile app

Receipt-driven personal ledger for Android and iOS, built from one codebase.
The authoritative design document is
[`YourIntelliLedger-Mobile-Dev-Spec.md`](./YourIntelliLedger-Mobile-Dev-Spec.md);
section references throughout the code (`§4.4`, `§5.1`, …) point into it.

## Requirements

| Tool | Version | Why it matters |
|---|---|---|
| Node | 20+ | Must be on the PATH of whatever launches the build — see [Android Studio](#android-studio) |
| **JDK** | **17** (Temurin or equivalent) | **Not whatever is newest.** JDK 26 fails the current AGP's `jlink`/`androidJdkImage` step outright, and takes `react-native-svg` and `react-native-masked-view` down with it — a failure that reads like a New Architecture problem but isn't (spec §1.1, §12 item 1). |
| Xcode | latest | iOS builds only — **not yet installed on this machine**, so the iOS half of §12 item 1 is unverified |

`npm run android` pins `JAVA_HOME` to JDK 17 automatically via
[`scripts/with-jdk17.js`](./scripts/with-jdk17.js), so the pin survives
`expo prebuild` regenerating `android/`. Use the same script in CI. Android
Studio uses its own bundled JDK instead; both work, and the detail is in the
Android Studio section below.

This is an Expo **development build** — native modules mean Expo Go cannot run
it.

```bash
npm install
npm run android      # or: npm run ios
```

## Scripts

| Command | Does |
|---|---|
| `npm start` | Metro dev server |
| `npm run android` / `npm run ios` | Build and install a development build |
| `npm run prebuild` | Regenerate `ios/` and `android/` from `app.config.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Jest, both projects |
| `npm run check:gradle` | Fail if the Gradle wrapper has drifted (runs automatically before `npm run android`) |

## Android Studio

**Both build paths work.** `npm run android` builds, installs, creates the
`adb reverse` tunnel, starts Metro and pins JDK 17 in one step. Android Studio
imports and compiles the project too, and is where logcat, the emulator
manager, the layout inspector and native debugging live.

Getting Studio working took four fixes. They are recorded here because each one
presents as a different problem than it is, and a new machine will need them
again.

**1. `Exec failed, error: 2 (No such file or directory)` is `node`, not your
project.** The generated Gradle files and Expo's autolinking plugin shell out
to `node` via `Runtime.exec`, which bypasses the shell and resolves only
against the inherited PATH. A Dock-launched Studio gets the bare launchd PATH,
which has no Homebrew. Proven by A/B: identical folder and JDK, fails without
`/opt/homebrew/bin` on PATH, builds with it.

A config plugin *cannot* fix this — patching the generated files covers 7 of 9
call sites, and `expo-autolinking-settings` hardcodes `"node"` in Kotlin with
no property or environment override. **Resolved on this machine** by giving
launchd itself a PATH, which fixes every GUI app permanently:

```bash
sudo launchctl config user path /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
# then reboot; verify with:
launchctl getenv PATH
```

The setting is read at login, so it does nothing until a restart. On a machine
where you can't do that, launching Studio from a terminal
(`"/Applications/Android Studio.app/Contents/MacOS/studio" &`) inherits your
shell PATH and works for that session.

**2. Android Studio upgrades the Gradle wrapper behind your back.** It bumped
9.3.1 → 9.6.1 twice here (31 Jul and 3 Aug). Under 9.6.1 the Kotlin compiler
fails on React Native's own Gradle plugin and reports only "Internal compiler
error", minutes into the build. **Decline the "Upgrade Gradle" prompt.**
`npm run check:gradle` catches the drift in about a second; it reads the
expected version from `@react-native/gradle-plugin`, so a React Native upgrade
moves the expectation automatically.

**3. Moving the project breaks the native build cache.** CMake bakes absolute
paths into `node_modules/**/android/.cxx/`, so after relocating the repo the
build fails with a `FileNotFoundException` naming the *old* path. Java build
state relocates fine; C++ toolchain state does not. The fix is to delete the
regenerable caches — `.cxx/` and `android/build/` under `node_modules`, plus
`android/.gradle`, `android/build`, `android/app/build` — and rebuild.

**4. The Gradle JDK is a separate setting from the CLI's.**
`scripts/with-jdk17.js` only pins `JAVA_HOME` for `npm run android`. Studio
reads `.idea/gradle.xml`, which lives inside the generated tree and is wiped by
prebuild, so `scripts/pin-android-studio-jdk.js` restores it as a
`postprebuild` hook. It **fills in a missing value and never overwrites an
existing one**, so a JDK chosen in Studio's Settings survives a regenerate.

Studio currently resolves `#GRADLE_LOCAL_JAVA_HOME` to its own bundled JBR 21;
the CLI uses Temurin 17. Both build. The only JDK that must never be used is
the machine default (Corretto 26), which fails AGP's `jlink` step. The cost of
the split is that Gradle runs **one daemon per JVM**, so alternating between
Studio and the CLI can trigger a full recompile and doubles daemon memory —
`./android/gradlew --status` lists them.

Finally, and independent of Studio: **a debug build has no bundled JS.** It
fetches it from Metro at launch, so with no Metro running the app sits on the
splash screen forever with no error. Studio starts neither Metro nor the
tunnel. After every replug:

```bash
adb reverse tcp:8081 tcp:8081
```

For an APK that runs with no laptop attached, `cd android && ./gradlew
assembleRelease` embeds the bundle.

## Layout

```
src/
  app/            expo-router screens — shared, no platform forks
  data/           db, migrations, repositories, money/date helpers   100% shared
  agent/          loop, hubClient, prompt, tools, validate, compile  (Weeks 7–8)
  fastpath/       regex + date parsing                               (Week 8)
  render/         envelope → text / table / chart                    (Week 8)
  capture/        scanner, camera, OCR, geometry, line reconstruction (Weeks 5–6)
  ui/             components, theme, stores
  types/          closed vocabularies, ledger types
  platform/       the ONLY place platform forks are permitted

__tests__/        node (data + logic) and ui (component) suites
plugins/          local Expo config plugins — native config with no official plugin
scripts/          build-environment guards (JDK pin, wrapper drift, IDE JDK)
e2e/              Maestro flows                                       (Week 10)
assets/receipts/  OCR fixture corpus                                  (Weeks 5–6)
```

`ios/` and `android/` are **generated** by `expo prebuild` and are not
committed — all native configuration lives in `app.config.ts` (spec §2.3).

Two rules worth repeating because they are cheap to break:

1. Screens never import `db.ts` or a driver — only repositories (§2.2 rule 1).
2. No `Platform.OS` branching outside `src/platform/`, except trivial cosmetics
   via an inline `Platform.select()` (§2.2 rule 3).

**Android and iOS only.** There is no web target: a third render target would
legitimise the `.web.tsx` forks that rule 3 exists to prevent.

## Testing

Two Jest projects (see [`jest.config.js`](./jest.config.js)):

- **`node`** — the data layer and pure logic. `expo-sqlite` cannot run in Node,
  so `src/data/driver.ts` defines a narrow `SqlDriver` interface that
  `expo-sqlite` implements in the app and `better-sqlite3` implements under
  test. That is what makes §10's "Jest + in-memory SQLite" integration tests —
  real transactions, real rollbacks, real `CHECK` constraints — possible at
  all.
- **`ui`** — component tests via `@testing-library/react-native`. Note that
  `render` and `fireEvent` are **async** in v14 (React 19's act boundary);
  a missing `await` fails with the misleading "`render` function has not been
  called".

```bash
npm test            # both projects, as two separate Jest invocations
npm run test:node   # just the data layer
npm run test:ui     # just the components
```

**`npm test` runs the two projects as separate invocations on purpose.** Jest
reuses worker processes across projects, and the React Native preset's global
setup leaks into `node` test files that land on a worker after it. About one
run in four, `await expect(...).rejects.toThrow()` reported "Received function
did not throw" for SQLite errors that *were* thrown — so the schema's CHECK and
foreign-key tests failed at random and looked for all the world like the
constraints were missing from migration 001. `--runInBand` reproduces it too;
separate invocations never do. If you go back to a single `jest` run, expect
that ghost to return.

Per §10, a feature is not done until its E2E flow passes on **both**
platforms, verified on one physical Android device and one physical iPhone.

## Status

**Weeks 3 and 4 of the §11 plan are complete.** Schema and migrations,
repositories with the §4.11 integrity checks, manual bill entry, the ledger
list / detail / edit / delete flow, and the Insights tab — period summaries,
category and merchant breakdowns, and a month-over-month trend chart. Capture
(§5) and the agent (§6) are stubbed routes that render an honest "not built
yet" empty state.

Insights, verified on device with real data:

- Category breakdown reconciles with the headline total. Categories live on
  line items, so an itemless bill (§5.1) belongs to no category — it appears
  as an explicit muted **"Not itemised"** bar instead of quietly vanishing.
  Observed: Produce $2.99 + Not itemised $1.00 = the $3.99 total.
- The trend keeps empty months as zeros rather than closing the gap, and
  renders 12 months on a 720 px screen without clipping.
- Charts use `react-native-gifted-charts` (§12 item 3 settled). It has an
  **undeclared peer dependency on a gradient package** — without
  `expo-linear-gradient` the screen throws at import time, which typecheck and
  lint cannot see because the require is internal to the library.

Verified on a physical Galaxy A03 (Android 13, arm64, Unisoc T606 — the
low-end row of the §1.3 matrix):

- Manual bill entry writes, and bills survive app restart **and a full APK
  replacement** — the §11 "a manual bill survives restart" bar, on Android.
- An **itemless bill** (§5.1) stores and displays correctly, showing "No
  itemised lines" rather than a bogus zero.
- Month header totals sum `bills.total_cents`, so itemless bills are included —
  the §14.6 undercount trap, confirmed working with real data.
- The **release build runs standalone** with no Metro and no tunnel, under R8.

Automated: 96 data-layer and unit tests, 8 component tests, typecheck and lint
clean.

Release size against the §8.4 budget of < 45 MB, measured on the arm64 slice
with R8 on:

| | |
|---|---|
| dex | 7.7 MB (18.5 MB before R8) |
| native libs, compressed | 14.7 MB |
| ML Kit OCR assets, JS bundle, other | 10.3 MB |
| **estimated download** | **≈ 32.7 MB** |

Native libraries are stored *uncompressed* in the APK
(`expo.useLegacyPackaging=false`), so the 59 MB on-disk release APK badly
overstates what Play transfers. An authoritative figure needs `bundletool`
against an AAB, which is worth doing before Week 10.

### Known gaps

- **Bill edit and delete are untested on device.** The repository logic is
  covered by integration tests, but the screens themselves have only been
  exercised as far as entry and listing.
- **Insights' "no bills in this period" empty state is untested on device** —
  every period in the current data contains bills, so that branch has only
  been reasoned about, not seen.
- **iOS is entirely unverified.** Xcode is not installed on this machine, so
  §11's Week 3 bar ("`expo prebuild` produces working iOS *and* Android
  projects") is met on Android only, and the iOS half of §12 item 1 — App
  Attest, VisionKit, ML Kit's iOS pod under the New Architecture — is still
  open. Per §11, do not let this drift into a "port later" phase.
- **Release builds are signed with the debug keystore.** Fine for demos; §9.2
  requires Play App Signing with the upload key in EAS credentials before any
  store release.
- **`insightsRepo`, the data catalog and MMKV prefs are not built** (Week 4 and
  §6.3). `receipt_scans` exists in migration 001 but nothing writes to it yet,
  so Weeks 5–6 need no schema change.
