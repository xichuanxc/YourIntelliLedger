#!/usr/bin/env node
/**
 * Writes `android/local.properties` with `sdk.dir`.
 *
 * Gradle needs to be told where the Android SDK is, and `expo prebuild` does
 * not write this file — Android Studio does, on first sync. So a prebuild
 * followed by a command-line build fails before it compiles anything:
 *
 *     SDK location not found. Define a valid SDK location with an
 *     ANDROID_HOME environment variable or by setting the sdk.dir path in
 *     your project's local properties file
 *
 * which reads like a machine misconfiguration rather than what it is: a
 * generated file that has not been generated yet. Same class of problem as
 * `pin-android-studio-jdk.js`, and it runs from the same `postprebuild` hook.
 *
 * The path is machine-specific, which is why the file is gitignored and why
 * this derives it rather than hardcoding one.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const localProperties = path.resolve(__dirname, '../android/local.properties');

/** Where the SDK is, in the order the Android tools themselves look. */
function findSdk() {
  for (const variable of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = process.env[variable];
    if (value && fs.existsSync(value)) return value;
  }

  const defaults = {
    darwin: path.join(os.homedir(), 'Library/Android/sdk'),
    linux: path.join(os.homedir(), 'Android/Sdk'),
    win32: path.join(os.homedir(), 'AppData/Local/Android/Sdk'),
  };

  const fallback = defaults[process.platform];
  return fallback && fs.existsSync(fallback) ? fallback : null;
}

if (!fs.existsSync(path.resolve(__dirname, '../android'))) {
  console.log('[write-local-properties] no android/ yet — run prebuild first');
  process.exit(0);
}

if (fs.existsSync(localProperties)) {
  // Android Studio owns this file once it exists; it may point somewhere
  // deliberate. Overwriting would be a silent way to lose that.
  console.log('[write-local-properties] local.properties already present — left alone');
  process.exit(0);
}

const sdk = findSdk();
if (!sdk) {
  console.warn(
    '[write-local-properties] Android SDK not found. Set ANDROID_HOME, or open ' +
      'android/ in Android Studio once and let it write local.properties.'
  );
  process.exit(0);
}

// Gradle reads this as a Java properties file, where a backslash escapes the
// next character — so Windows paths must be escaped or the drive letter is lost.
fs.writeFileSync(localProperties, `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`);
console.log(`[write-local-properties] sdk.dir=${sdk}`);
