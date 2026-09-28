/**
 * Android build settings that must survive `expo prebuild`.
 *
 * `android/gradle.properties` is generated and gitignored (spec §2.3), so
 * editing it directly means the setting is lost on the next regenerate — and
 * silently, which is the worst kind of loss for a size budget. These go
 * through a config plugin instead, per §2.2 rule 5.
 *
 * ## What is set, and why
 *
 * **R8 (`enableMinifyInReleaseBuilds`)** — off by default in Expo's template.
 * Measured on the arm64 slice: dex 18.5 MB → 7.7 MB, taking the estimated
 * download from ~44 MB to ~33 MB against §8.4's 45 MB budget. Verified the
 * minified build launches and renders the ledger on a physical device; R8
 * rewrites bytecode and can break reflection, so treat a crash that only
 * reproduces in release as a suspect here first. `proguard-rules.pro` is
 * where fixes go. Turning it on now, rather than in Week 10, means every
 * feature is exercised under R8 as it lands.
 *
 * **`shrinkResources`** — drops unreferenced resources; only legal with R8 on.
 *
 * **`reactNativeArchitectures`** — the template ships four ABIs including
 * `x86`, which §1.1 does not list. Narrowed to the three the spec names.
 * This does not change what a user downloads (Play splits per ABI); it
 * removes one redundant native compile from every build.
 *
 * **`org.gradle.java.home`** — which JDK Gradle itself runs on, pinned to one
 * the Android Gradle Plugin supports. See `supportedJdk` below.
 *
 * For a faster local build, override per-invocation rather than editing
 * anything — the value only affects which ABIs get compiled:
 *
 *     ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
 */

const { execFileSync } = require('node:child_process');

const { withGradleProperties } = require('expo/config-plugins');

/**
 * JDKs the Android Gradle Plugin can actually run on, best first.
 *
 * Expo SDK 57 and React Native 0.86 target 17; 21 is the other long-term
 * release AGP supports, and is a usable fallback for a machine without 17.
 */
const USABLE_JDKS = ['17', '21'];

/**
 * A JDK Gradle can run on, or null to leave the choice alone.
 *
 * With `JAVA_HOME` unset, Gradle takes whatever the system calls default,
 * and on macOS that is simply the newest installed. A machine that acquires
 * a JDK too new for AGP therefore breaks Android builds with no change to
 * this project: `jlink` fails transforming `core-for-system-modules.jar`,
 * and the CMake steps for the native modules die on a restricted-method
 * warning. Six task failures, none of them ours, and nothing in the error
 * says "wrong JDK".
 *
 * Pinning here rather than in a shell profile keeps the fix with the project
 * that needs it. `android/gradle.properties` is generated and gitignored, so
 * the absolute path written below is this machine's alone and is recomputed
 * wherever the project is next prebuilt — which is the only reason it is
 * acceptable to write an absolute path at all.
 *
 * Returns null off macOS, where `java_home` does not exist; there, whatever
 * `JAVA_HOME` says is left untouched.
 */
function supportedJdk() {
  if (process.platform !== 'darwin') return null;

  for (const version of USABLE_JDKS) {
    try {
      const home = execFileSync('/usr/libexec/java_home', ['-v', version], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (home) return home;
    } catch {
      // Not installed. Try the next one.
    }
  }

  // Nothing suitable: say so rather than pinning to something that will fail
  // further in, where the error will not mention Java at all.
  console.warn(
    `[with-android-build-props] No JDK ${USABLE_JDKS.join(' or ')} found. ` +
      'Gradle will use the system default, which may be too new for the ' +
      'Android Gradle Plugin.'
  );
  return null;
}

/** §1.1. `x86` is deliberately absent; emulators on Apple Silicon are arm64. */
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'].join(',');

function properties() {
  const settings = {
    'android.enableMinifyInReleaseBuilds': 'true',
    'android.enableShrinkResourcesInReleaseBuilds': 'true',
    reactNativeArchitectures: ANDROID_ABIS,
  };

  const jdk = supportedJdk();
  if (jdk) settings['org.gradle.java.home'] = jdk;

  return settings;
}

const withAndroidBuildProps = (config) =>
  withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(properties())) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    }
    return cfg;
  });

module.exports = withAndroidBuildProps;
