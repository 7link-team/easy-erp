// Run locally, never in CI: release identities must survive individual builds.
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const directory = join(homedir(), ".config/easy-erp/signing");
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
function run(binary, args) {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
  } catch {
    throw new Error(
      `Signing identity generation failed using ${binary}; existing keys were not overwritten.`,
    );
  }
}
const updater = join(directory, "updater.key");
if (!existsSync(updater)) {
  run(process.execPath, [
    resolve("node_modules/@tauri-apps/cli/tauri.js"),
    "signer",
    "generate",
    "--ci",
    "--password",
    "",
    "--write-keys",
    updater,
  ]);
  chmodSync(updater, 0o600);
}
const android = join(directory, "android-release.p12");
const password = join(directory, "android-password");
if (existsSync(android) && !existsSync(password))
  throw new Error(
    "Android key exists without its password file; restore the password before continuing.",
  );
if (!existsSync(android)) {
  if (!existsSync(password))
    writeFileSync(password, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  const temporary = mkdtempSync(join(tmpdir(), "easy-erp-signing-"));
  try {
    const key = join(temporary, "key.pem");
    const cert = join(temporary, "cert.pem");
    // OpenSSL reads consecutive lines when passin/passout reference one file.
    const exportPassword = join(temporary, "export-password");
    writeFileSync(exportPassword, readFileSync(password), { mode: 0o600 });
    run("openssl", [
      "req",
      "-batch",
      "-new",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-days",
      "10000",
      "-subj",
      "/CN=Easy ERP Android Release",
      "-keyout",
      key,
      "-out",
      cert,
      "-passout",
      `file:${password}`,
    ]);
    run("openssl", [
      "pkcs12",
      "-export",
      "-name",
      "easy-erp",
      "-in",
      cert,
      "-inkey",
      key,
      "-passin",
      `file:${password}`,
      "-out",
      android,
      "-passout",
      `file:${exportPassword}`,
    ]);
    chmodSync(android, 0o600);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
console.log(
  `Signing identities are ready in ${directory}. Keep an offline backup; never commit private keys or passwords.`,
);
