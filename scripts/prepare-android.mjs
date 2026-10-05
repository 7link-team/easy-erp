import { readFileSync, writeFileSync } from "node:fs";

const path = "desktop/gen/android/app/build.gradle.kts";
let source = readFileSync(path, "utf8");
// The stock release manifest blocks plain HTTP; LAN inventory hosts use HTTP.
const cleartext = 'manifestPlaceholders["usesCleartextTraffic"] = "false"';
if (!source.includes(cleartext))
  throw new Error(
    "Android template changed: review the LAN network configuration.",
  );
source = source.replace(
  cleartext,
  'manifestPlaceholders["usesCleartextTraffic"] = "true"',
);
if (process.env.ANDROID_KEYSTORE_BASE64) {
  for (const name of [
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  ]) {
    if (!process.env[name]) throw new Error(`Missing signing secret ${name}`);
  }
  const keystore = `${process.env.RUNNER_TEMP}/easy-erp-release.jks`;
  writeFileSync(
    keystore,
    Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, "base64"),
    { mode: 0o600 },
  );
  writeFileSync(process.env.GITHUB_ENV, `ANDROID_KEYSTORE_PATH=${keystore}\n`, {
    flag: "a",
  });
  source = source
    .replace(
      "    buildTypes {",
      `    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {`,
    )
    .replace(
      'getByName("release") {',
      'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")',
    );
}
writeFileSync(path, source);
const sdk = source.match(/compileSdk\s*=\s*(\d+)/)?.[1];
if (!sdk) throw new Error("Cannot determine Android compile SDK.");
if (process.env.GITHUB_ENV)
  writeFileSync(process.env.GITHUB_ENV, `ANDROID_COMPILE_SDK=${sdk}\n`, {
    flag: "a",
  });
