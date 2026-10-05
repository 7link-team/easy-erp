import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

for (const name of [
  "RUNNER_TEMP",
  "IOS_CERTIFICATE_BASE64",
  "IOS_CERTIFICATE_PASSWORD",
  "IOS_PROFILE_BASE64",
  "APPLE_DEVELOPMENT_TEAM",
]) {
  if (!process.env[name])
    throw new Error(`Missing iOS signing setting ${name}`);
}
const temp = process.env.RUNNER_TEMP;
const certificate = join(temp, "ios-distribution.p12");
const profile = join(temp, "ios-profile.mobileprovision");
const keychain = join(temp, "easy-erp-signing.keychain-db");
writeFileSync(
  certificate,
  Buffer.from(process.env.IOS_CERTIFICATE_BASE64, "base64"),
  { mode: 0o600 },
);
writeFileSync(profile, Buffer.from(process.env.IOS_PROFILE_BASE64, "base64"), {
  mode: 0o600,
});
const password = randomBytes(32).toString("hex");
// Avoid printing private material, certificate passwords or subprocess argv.
function security(args) {
  try {
    return execFileSync("security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Apple signing identity import failed; check certificate, password and profile secrets.",
    );
  }
}
security(["create-keychain", "-p", password, keychain]);
security(["set-keychain-settings", "-lut", "21600", keychain]);
security(["unlock-keychain", "-p", password, keychain]);
security([
  "import",
  certificate,
  "-P",
  process.env.IOS_CERTIFICATE_PASSWORD,
  "-A",
  "-t",
  "cert",
  "-f",
  "pkcs12",
  "-k",
  keychain,
]);
security([
  "set-key-partition-list",
  "-S",
  "apple-tool:,apple:",
  "-k",
  password,
  keychain,
]);
security(["list-keychains", "-d", "user", "-s", keychain]);
const decoded = security(["cms", "-D", "-i", profile]);
const uuid = decoded.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
if (!uuid || !/^[A-Fa-f0-9-]+$/.test(uuid))
  throw new Error("Invalid provisioning profile UUID.");
const profiles = join(homedir(), "Library/MobileDevice/Provisioning Profiles");
mkdirSync(profiles, { recursive: true });
writeFileSync(
  join(profiles, `${uuid}.mobileprovision`),
  Buffer.from(process.env.IOS_PROFILE_BASE64, "base64"),
  { mode: 0o600 },
);
console.log("Imported temporary iOS signing identity.");
