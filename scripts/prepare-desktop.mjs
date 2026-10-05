import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cargo = process.env.CARGO ?? "cargo";
const rustc = process.env.RUSTC ?? "rustc";
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";
if (["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM)) {
  console.log("Mobile client: no inventory server is bundled.");
  process.exit(0);
}
const target =
  process.env.ERP_BUILD_TARGET ??
  execFileSync(rustc, ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )?.[1];
if (!target) throw new Error("Cannot determine Rust target");
// A fixed shell command also resolves npm.cmd on Windows.
execSync("npm run build", { cwd: root, stdio: "inherit" });
execFileSync(
  cargo,
  [
    "build",
    "--locked",
    ...(debug ? [] : ["--release"]),
    "--target",
    target,
    "-p",
    "easy-erp-server",
  ],
  { cwd: root, stdio: "inherit" },
);
mkdirSync(resolve(root, "desktop/binaries"), { recursive: true });
const suffix = process.platform === "win32" ? ".exe" : "";
copyFileSync(
  resolve(root, `target/${target}/${profile}/easy-erp-server${suffix}`),
  resolve(root, `desktop/binaries/easy-erp-server-${target}${suffix}`),
);
console.log(`Prepared desktop sidecar for ${target}`);
