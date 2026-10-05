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
| Xcode | 26+ | iOS builds. Point `xcode-select` at `Xcode.app`, not the Command Line Tools, and re-accept the licence after each Xcode update — both surface as unrelated-looking errors. |
| **Project path** | **no spaces anywhere above the repo** | See [iOS](#ios). This is not a preference; two separate packages break on it. |

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

## iOS

Verified on a physical iPhone SE (3rd gen), iOS 26.5.2, Xcode 26.6: builds,
signs, installs and runs. The ML Kit pods resolve at **GoogleMLKit 8.0.0**
with every script variant the §3 gate needs — Chinese, Japanese, Korean and
Devanagari — which closes the compile-and-link half of §12 item 1.

```bash
npx expo prebuild --platform ios   # generates ios/ and runs pod install
npm run ios                        # or: npx expo run:ios --device <udid>
```

**A Debug build always needs Metro. There is no standalone `__DEV__` build.**
Worth knowing before trying, because the attempt looks like it should work.

React Native's own `react-native-xcode.sh` embeds the bundle for a physical
device and skips only for the Simulator — but Expo's generated build phase
overrides that:

```sh
if [[ "$CONFIGURATION" = *Debug* ]]; then
  export SKIP_BUNDLING=1
fi
```

so a Debug `.app` contains `ip.txt` and no JS at all. The same script sources
`.xcode.env.updates` afterwards, commented "to allow SKIP_BUNDLING to be unset
if needed", which reads like a sanctioned override. It is not one for this
purpose: `unset SKIP_BUNDLING` does produce a bundle, and the resulting app
dies at startup with

```
[runtime not ready]: Error: Cannot create devtools websocket connections in
embedded environments.
```

thrown unconditionally by `@expo/log-box`:

```js
if (!devServer.bundleLoadedFromServer) { throw new Error(…); }
```

`__DEV__` pulls LogBox in and LogBox requires a dev server, so the skip is
load-bearing rather than an oversight. **For a build that runs away from the
laptop, use `--configuration Release`** — it embeds the bundle and never
consults Metro. The cost is `__DEV__`: no dev-tool icons on the Ledger, no
parse timing line on the review screen. Move those behind a runtime
preference if a standalone build needs them.

Note this is separate from *reachability*. A Debug build on a network with
client isolation (most campus Wi-Fi) cannot reach Metro on the laptop either,
and fails the same way from the user's side. Android is immune because
`adb reverse` tunnels over USB; iOS has no equivalent, so the workaround there
is a personal hotspot.

**The project path must not contain a space.** This cost a full debugging
cycle and is worth stating plainly. Two independent packages interpolate the
project path into a shell command without quoting it:

- `expo-constants` — `bash -l -c "$PODS_TARGET_SRCROOT/../scripts/…"`
- **React Native itself** — backticks around `"$NODE_BINARY" --print …` in the
  *Bundle React Native code and images* phase

Either one fails with `bash: /Users/…/COMPX576: No such file or directory`,
which Xcode reports only as `Command PhaseScriptExecution failed with a
nonzero exit code` — pointing at the build system rather than at the path.
Everything else in the workspace quotes correctly, so it is tempting to patch
the one that broke; that is how the second one gets found. The repo therefore
lives at `COMPX576-Programming-Project`, hyphenated.

**Signing.** [`plugins/with-ios-signing.js`](./plugins/with-ios-signing.js)
sets the development team, because `ios/` is regenerated and a team chosen in
Xcode's UI does not survive — the same trap as `android/gradle.properties`.
Override with `APPLE_TEAM_ID` on another machine.

On a **free** Apple account:

- Push Notifications cannot be provisioned at all. This is why
  `expo-notifications` was removed; it was unused, and the spec lists
  notifications as a v2 hook.
- Profiles last **seven days**. Rebuilding re-signs.
- The first install on a device will not launch until the certificate is
  trusted by hand: **Settings → General → VPN & Device Management →
  Developer App → Trust**. The error otherwise names an "invalid code
  signature", which sounds fatal and is not.

**Do not filter a build's output until it has failed once.** Piping
`xcodebuild` through `grep`/`head` returns *grep's* exit status and truncates
the real message; that hid the actual signing error for two cycles here.

**`npm run ios` cannot sign this project from cold.** It has no way to pass
`-allowProvisioningUpdates` to `xcodebuild`, so when no provisioning profile
exists yet for `nz.yourintelliledger.app` — a fresh machine, or seven days
after the last build — it fails with *"Automatic signing is disabled and
unable to generate a profile"* even though `CODE_SIGN_STYLE` is `Automatic`.
Xcode is allowed to *use* a profile unattended but not to *create* one. Drive
`xcodebuild` directly once and the cached profile makes `npm run ios` work
again until it lapses:

```sh
cd ios
xcodebuild -workspace YourIntelliLedger.xcworkspace -scheme YourIntelliLedger \
  -configuration Release -destination "id=<device udid>" \
  -derivedDataPath build -allowProvisioningUpdates build
xcrun devicectl device install app --device <device id> \
  build/Build/Products/Release-iphoneos/YourIntelliLedger.app
```

**`.xcode.env.local` must name the Homebrew symlink, not a Cellar path.** It is
gitignored and machine-local, and it exists because Xcode's script phases do
not inherit a login shell `PATH`, so `.xcode.env`'s `$(command -v node)` finds
nothing. Written as `/opt/homebrew/Cellar/node/<version>/bin/node` it stops
working the next time `brew upgrade` runs, and the failure surfaces as a
*Hermes* script phase dying with `No such file or directory` — days after the
upgrade that caused it, and nowhere near node. Use `/opt/homebrew/bin/node`.

**The development tools need a flag on iOS.** The two ledger-header buttons
(load sample receipts, clear all data) and the parse-timing readout on the
review screen are shared code gated on `__DEV__`, which is true on Android
because `npm run android` builds Debug. iOS has no standalone Debug build, so
they never appear on a phone. Build Release with

```sh
DEV_TOOLS=1 xcodebuild … -configuration Release …
```

which `app.config.ts` turns into `extra.devTools`, read by
`src/ui/devTools.ts`. An `EXPO_PUBLIC_` name does **not** work for this: those
are inlined from `.env` files, and a value exported in the shell that runs
`xcodebuild` never reaches the bundle — verified by exporting with and without
it and getting byte-identical output. `app.config.ts` is evaluated by a build
phase that does inherit the environment, which is why the flag lives there.

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

**3a. `SDK location not found` right after a prebuild.**
`android/local.properties` carries `sdk.dir`, is machine-specific and therefore
gitignored, and is written by Android Studio on first sync — not by prebuild.
So a prebuild followed straight by a command-line build fails before compiling
anything, with a message that reads like a broken machine rather than a
generated file that has not been generated yet.
`scripts/write-local-properties.js` writes it from `ANDROID_HOME` or the
platform default, as a `postprebuild` hook. Like the JDK pin, it **never
overwrites an existing file** — Studio owns it once it exists.

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
constraints were missing from migration 001. `--runInBand` reproduces it too.

Separate invocations reduce it from roughly one run in four to rare, but do
**not** eliminate it: it has since reappeared once, on the first run after
`npm install` changed `node_modules`, then passed 10 runs in a row. The tell is
always the same — exactly 4 failures, all of them `rejects.toThrow()`
assertions about SQLite constraint errors. **Re-run before believing it.** If a
constraint test fails twice in a row, that is a real defect; once is this
ghost.

Per §10, a feature is not done until its E2E flow passes on **both**
platforms, verified on one physical Android device and one physical iPhone.

## Status

**Weeks 3 and 4 of the §11 plan are complete, and Week 5 is built with the
gallery path verified on device.** Schema and migrations, repositories with the
§4.11 integrity checks, manual bill entry, the ledger list / detail / edit /
delete flow, the Insights tab, and capture through to raw text (§5.1). The
agent (§6) is still a stubbed route.

### Week 5 capture, verified on device

Run on a physical Galaxy A03 against `taier_cbd_20260614` from the corpus, via
the gallery path:

```
Path: gallery   Pages: 1   Words: 114   Lines: 39   Time: 1357 ms   Skew: 0.00°
```

**The §3 recognition-script gate is settled for Android.** The Chinese came
through — `太二新西兰奥克兰CBD店`, `沸腾府婆豆腐`, `重庆口水鸡` — and every one of
those lines would have been *silently dropped* under the binding's `LATIN`
default, absent rather than garbled, exactly as the prototype found with
Vision. ML Kit's `CHINESE` model reads Latin alongside it, so a single pass
covers the bilingual corpus. §4.10's search depends on this: a `name_local`
lost at OCR can never be found later.

**§11's "prototype fixtures reproduce on-device" bar is met for this receipt.**
Against the prototype's `out/taier_cbd_20260614.raw.txt`:

| | Prototype (Vision, macOS) | Device (ML Kit, Android) |
|---|---|---|
| Lines | 35 | 39 |
| Subtotal / GST / Total | 151.40 / 19.75 / 151.40 | **identical** |
| Column structure | `Mapg Tofu␣␣␣␣1/Serving␣␣␣␣18.80` | `Mapo Tofu␣␣␣␣1/Serving␣␣␣␣18.80` |

The *structure* matches; the differences are per-glyph OCR and run in both
directions — ML Kit read `Mapo` and `Order No.` correctly where Vision gave
`Mapg` and `rder No.`, and recovered a dish name Vision lost entirely, while
Vision read `麻` and `腐竹` correctly where ML Kit gave `府` and `廣竹`. §5.4
anticipated that block/line granularity might differ per platform and said the
*thresholds*, not the algorithm, would need adjusting. They did not.

**Two things this run does not establish.** The 1357 ms sits inside §8.4's
1.5 s budget with only 143 ms to spare, but a rendered PDF is flat, evenly lit
and perfectly square — a phone photo of a crumpled thermal receipt is none of
those, so read it as an optimistic floor rather than a pass. And the 0.00°
skew means geometry correction (§5.3) was never exercised beyond confirming it
declines to act on a level page.

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

Automated: 182 data-layer and unit tests, 8 component tests, typecheck and lint
clean. That includes a parity test pinning the §5.4 port to the Python it was
ported from — 200 generated receipts, exact match — skipped when `python3` is
unavailable.

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

### Measured on device — iPhone SE (3rd generation), Release

One month's real use, read from Settings → Usage on 5 October 2026. These are
the app's own counters (§15.3: counts and timings only, never question text or
amounts), not a benchmark run.

| | |
|---|---|
| Requests | 51 |
| of those, receipt reads | 43 |
| Tokens | 152,473 in / 17,942 out |
| Typical time | **3.6 s** |
| Failed | 15 |

**Typical time is the median round trip over all 51 requests**, most of which
are receipt parses — so it is the figure to read against §5.7's ≤ 6 s for a
parse, and it sits comfortably inside it. It is *not* §6.8's split of fast-path
p95 and agent first-token p50/p95; those have their own panel in Settings and
no figures yet, because they need questions asked rather than receipts read.

**The 15 failures are explained, and both causes are now fixed.** They
accumulated across the month, before either repair. The hub published
`gemini-3.6-flash-lite` as the parse model and that model does not exist, so
every request naming it came back 404; and `thinkingLevel: minimal` is rejected
outright by `gemini-3.7-flash` and `gemini-3.8-flash`, which answer 400 with
"Thinking level MINIMAL is not supported for this model". The model is now
chosen from a list of names checked against the live API, and the thinking
level is per model with a retry one rung up. A failure costs no tokens, which
is why 51 requests and 43 receipts read are consistent with 15 of them failing.

### Known gaps

- **The scanner and camera capture paths are untested on device.** Both need a
  real receipt in front of the lens. The scanner additionally depends on Google
  Play Services, so whether it runs at all on this Unisoc device — or falls
  through to the camera, which is the §5.2 case the fallback exists for — is
  unknown.
- **Capture timing on a real photograph is unmeasured**, and geometry
  correction has not been exercised on a genuinely skewed image.
- **Bill edit and delete are untested on device.** The repository logic is
  covered by integration tests, but the screens themselves have only been
  exercised as far as entry and listing.
- **Insights' "no bills in this period" empty state is untested on device** —
  every period in the current data contains bills, so that branch has only
  been reasoned about, not seen.
- **iOS builds and runs, but nothing on it has been exercised.** §11's Week 3
  bar ("`expo prebuild` produces working iOS *and* Android projects") is now
  met on both, and ML Kit's iOS pod links under the New Architecture — but
  that is the *compile* half of §12 item 1. Still unverified on iOS: the
  VisionKit document scanner, ML Kit OCR at runtime, the parse and review
  flow, chart rendering, safe areas on a notched device, dark mode, and App
  Attest (§13.1), which has no implementation on either platform yet. Every
  "on both platforms" acceptance line in §11 Weeks 4–6 remains open.
- **Release builds are signed with the debug keystore.** Fine for demos; §9.2
  requires Play App Signing with the upload key in EAS credentials before any
  store release.
- **`insightsRepo`, the data catalog and MMKV prefs are not built** (Week 4 and
  §6.3). `receipt_scans` exists in migration 001 but nothing writes to it yet,
  so Weeks 5–6 need no schema change.
