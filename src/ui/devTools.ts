/**
 * Whether the on-device development tools are shown.
 *
 * They are normally `__DEV__`-gated, which is exactly right on Android: `npm
 * run android` builds Debug, so the buttons are there while developing and
 * absent from anything released.
 *
 * iOS has no such build. A Debug `.app` contains no JS at all — Expo's build
 * phase forces `SKIP_BUNDLING` — so it cannot run away from Metro, and Metro
 * needs the phone and the laptop on the same non-isolated network, which the
 * campus one is not (see the README). The only iOS build that runs standalone
 * is Release, and `__DEV__` is false there.
 *
 * So there is a second door, opened deliberately at build time:
 *
 *     DEV_TOOLS=1 xcodebuild … -configuration Release …
 *
 * which `app.config.ts` turns into `extra.devTools`. A build-time flag rather
 * than a Settings toggle on purpose: the tools delete data, and a toggle would
 * ship the capability to every user and rely on them never finding it. A flag
 * nobody typed leaves `extra.devTools` false in the built manifest, where the
 * running app cannot change it.
 */

import Constants from 'expo-constants';

export const DEV_TOOLS_ENABLED = __DEV__ || Constants.expoConfig?.extra?.devTools === true;
