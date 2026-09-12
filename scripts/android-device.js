#!/usr/bin/env node
/**
 * Prints the name of the attached **physical** Android device, for `--device`.
 *
 * This machine usually has emulators running that belong to other projects —
 * a Wear OS watch, sometimes a phone. An untargeted `expo run:android` takes
 * whichever device it finds first, and has already aimed a build at the watch.
 *
 * An emulator cannot verify this app anyway: it is a receipt scanner, so the
 * camera, ML Kit OCR and haptics are the point, and §6.2 requires streaming
 * verified on physical hardware. So "no phone attached" is an error worth
 * stopping for, not a reason to fall back to something that boots.
 *
 * The name printed is adb's `model:` field **verbatim**, because that is what
 * Expo matches `--device` against (`AndroidDeviceManager.resolveFromNameAsync`
 * compares against a name taken straight from that field). It is not
 * `ro.product.model`: adb prints `SM_A035F` where the device itself says
 * `SM-A035F`, and the hyphen does not match.
 */

const { execFileSync } = require('node:child_process');

function attachedDevices() {
  let output;
  try {
    output = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8' });
  } catch {
    fail('Could not run `adb`. Is the Android SDK platform-tools on your PATH?');
  }

  return output
    .split('\n')
    .slice(1) // "List of devices attached"
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...info] = line.split(/\s+/);
      const model = info.find((item) => item.startsWith('model:'));
      return {
        serial,
        state,
        // A device with no `model:` is unauthorised; adb only reports the
        // model once the user has accepted the debugging prompt.
        name: model ? model.replace('model:', '') : null,
      };
    })
    .filter((device) => device.serial && device.state);
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const devices = attachedDevices();
const physical = devices.filter((device) => !device.serial.startsWith('emulator-'));
const ready = physical.filter((device) => device.state === 'device' && device.name);

if (ready.length === 0) {
  const emulators = devices.filter((device) => device.serial.startsWith('emulator-'));
  const unauthorised = physical.filter((device) => device.state !== 'device' || !device.name);

  fail(
    [
      'No physical Android device is attached, so there is nothing to install to.',
      '',
      unauthorised.length
        ? `A phone is connected but not ready (${unauthorised
            .map((device) => `${device.serial}: ${device.state}`)
            .join(', ')}). Unlock it and accept the USB debugging prompt.`
        : 'Connect the phone by USB, unlock it, and accept the USB debugging prompt.',
      emulators.length
        ? `\n${emulators.length} emulator(s) are running and were ignored on purpose — ` +
          'this app needs a real camera, OCR and haptics, and §6.2 requires streaming ' +
          'verified on physical hardware.'
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

if (ready.length > 1) {
  fail(
    `More than one phone is attached (${ready
      .map((device) => device.name)
      .join(', ')}). Pass one explicitly: npm run android -- --device <name>`
  );
}

process.stdout.write(ready[0].name);
