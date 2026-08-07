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
 * For a faster local build, override per-invocation rather than editing
 * anything — the value only affects which ABIs get compiled:
 *
 *     ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
 */

const { withGradleProperties } = require('expo/config-plugins');

/** §1.1. `x86` is deliberately absent; emulators on Apple Silicon are arm64. */
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'].join(',');

const PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  reactNativeArchitectures: ANDROID_ABIS,
};

const withAndroidBuildProps = (config) =>
  withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
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
