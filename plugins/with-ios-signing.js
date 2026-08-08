/**
 * Sets the Apple development team on the generated Xcode project.
 *
 * `ios/` is generated and gitignored (spec §2.3), so setting the team in
 * Xcode's UI — or patching `project.pbxproj` by hand — is lost on the next
 * `expo prebuild`. The failure is quiet and confusing: the build stops with
 * "Signing for 'YourIntelliLedger' requires a development team", which reads
 * like a machine that has never been set up rather than a setting that was
 * just regenerated away.
 *
 * Same reasoning as `with-android-build-props.js`: anything that must survive
 * a regenerate goes through a config plugin (§2.2 rule 5).
 *
 * ## The team ID is not a secret
 *
 * It identifies the developer account, not a credential — it appears in every
 * built `.app`. What must never be committed is the signing *certificate* and
 * its private key, which live in the login keychain and are not touched here.
 *
 * The environment variable takes precedence so a different machine, or CI with
 * its own account, does not need this file edited.
 */

const { withXcodeProject } = require('expo/config-plugins');

/**
 * The Organizational Unit of the Apple Development certificate — read with:
 *
 *   security find-certificate -c "Apple Development: <email>" -p \
 *     | openssl x509 -noout -subject
 *
 * Note this is the OU, not the parenthetical in the common name; that one is
 * the individual's ID and Xcode will reject it as a team.
 */
const DEFAULT_TEAM_ID = 'XK5FSTURF6';

const withIosSigning = (config) =>
  withXcodeProject(config, (cfg) => {
    const teamId = process.env.APPLE_TEAM_ID || DEFAULT_TEAM_ID;
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key]?.buildSettings;
      // Comment entries share the section and have no buildSettings; and only
      // the app target carries a bundle identifier, so this skips the Pods
      // targets, which must not be signed with the app's team.
      if (!buildSettings?.PRODUCT_BUNDLE_IDENTIFIER) continue;

      buildSettings.DEVELOPMENT_TEAM = `"${teamId}"`;
      // Automatic, so Xcode mints and renews the provisioning profile itself.
      // A free account's certificates expire after seven days; managing that
      // by hand is a weekly interruption for no benefit.
      buildSettings.CODE_SIGN_STYLE = 'Automatic';
    }

    return cfg;
  });

module.exports = withIosSigning;
