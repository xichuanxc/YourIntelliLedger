#!/usr/bin/env node
/**
 * Writes `gradleJvm` into `android/.idea/gradle.xml` so Android Studio syncs
 * with JDK 17.
 *
 * Android Studio ignores the `JAVA_HOME` pin in `scripts/with-jdk17.js` — that
 * only covers `npm run android`. Studio uses its own setting, and its default
 * is whatever JDK it feels like, which on this machine means the AGP
 * `jlink`/`androidJdkImage` failure described in spec §1.1 and §12 item 1.
 *
 * `.idea/` lives inside the generated, gitignored `android/` tree, so
 * `expo prebuild` deletes it. This script runs as a `postprebuild` hook to put
 * the setting back. It is not a config plugin because `.idea/` is Android
 * Studio's own state directory, outside Expo's mod system.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_MAJOR = 17;
const gradleXml = path.resolve(__dirname, '../android/.idea/gradle.xml');

function findJdk17() {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('/usr/libexec/java_home', ['-v', String(REQUIRED_MAJOR)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  }
  for (const key of Object.keys(process.env)) {
    if (/^JAVA_HOME_17(_|$)/.test(key) && process.env[key]) return process.env[key];
  }
  return null;
}

// `expo prebuild` deletes android/ wholesale, so .idea/ is normally absent
// here and Studio would recreate it — without the pin — on first sync. Writing
// the file ourselves means the very first sync already uses JDK 17.
if (!fs.existsSync(path.dirname(gradleXml))) {
  if (!fs.existsSync(path.resolve(__dirname, '../android'))) {
    console.log('[pin-android-studio-jdk] no android/ yet — run prebuild first');
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(gradleXml), { recursive: true });
}

const javaHome = findJdk17();
if (!javaHome) {
  console.warn(
    `[pin-android-studio-jdk] JDK ${REQUIRED_MAJOR} not found; set Android Studio's ` +
      'Gradle JDK manually (Settings -> Build Tools -> Gradle -> Gradle JDK)'
  );
  process.exit(0);
}

const option = `<option name="gradleJvm" value="${javaHome}" />`;

if (!fs.existsSync(gradleXml)) {
  fs.writeFileSync(
    gradleXml,
    `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="GradleSettings">
    <option name="linkedExternalProjectsSettings">
      <GradleProjectSettings>
        ${option}
        <option name="externalProjectPath" value="$PROJECT_DIR$" />
      </GradleProjectSettings>
    </option>
  </component>
</project>
`
  );
  console.log(`[pin-android-studio-jdk] created gradle.xml with Gradle JDK ${javaHome}`);
  process.exit(0);
}

let xml = fs.readFileSync(gradleXml, 'utf8');

const existing = /<option name="gradleJvm" value="([^"]*)" \/>/.exec(xml);
if (existing) {
  // Fill in a missing value; never overwrite a deliberate one. Android Studio
  // writes its own choice here (e.g. its bundled `jbr-21`) when you pick a JDK
  // in Settings, and silently reverting that on the next prebuild would be a
  // surprising way to lose a decision.
  console.log(
    `[pin-android-studio-jdk] Gradle JDK already set to "${existing[1]}" — left alone. ` +
      `Delete the gradleJvm line and re-run to reset it to JDK ${REQUIRED_MAJOR}.`
  );
  process.exit(0);
} else if (xml.includes('<GradleProjectSettings>')) {
  xml = xml.replace('<GradleProjectSettings>', `<GradleProjectSettings>\n        ${option}`);
} else {
  console.warn('[pin-android-studio-jdk] unrecognised gradle.xml shape — left untouched');
  process.exit(0);
}

fs.writeFileSync(gradleXml, xml);
console.log(`[pin-android-studio-jdk] Gradle JDK pinned to ${javaHome}`);
