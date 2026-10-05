import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const tag = process.env.RELEASE_TAG;
const repo = process.env.RELEASE_REPOSITORY;
const version = JSON.parse(readFileSync("desktop/tauri.conf.json", "utf8")).version;
if (tag !== `v${version}`) throw new Error(`Tag must match application version v${version}.`);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("Invalid release repository.");
const platforms = {};
for (const [platform, target, extension] of [
  ["windows-x86_64", "x86_64-pc-windows-msvc", "exe"],
  ["darwin-x86_64", "x86_64-apple-darwin", "tar.gz"],
  ["darwin-aarch64", "aarch64-apple-darwin", "tar.gz"],
  ["linux-x86_64", "x86_64-unknown-linux-gnu", "AppImage"],
]) {
  const name = `easy-erp-${target}.${extension}`;
  // Never publish an update manifest that omits a desktop platform.
  const signature = readFileSync(join("release-assets", `${name}.sig`), "utf8").trim();
  if (!signature) throw new Error(`Missing signature for ${name}`);
  platforms[platform] = { signature, url: `https://github.com/${repo}/releases/download/${tag}/${name}` };
}
writeFileSync("release-assets/latest.json", JSON.stringify({ version, notes: "更新前请保存当前操作，并通知同事短暂暂停使用。", pub_date: new Date().toISOString(), platforms }, null, 2));
const hashes = readdirSync("release-assets").sort().filter(name => name !== "SHA256SUMS.txt").map(name => `${createHash("sha256").update(readFileSync(join("release-assets", name))).digest("hex")}  ${name}`);
writeFileSync("release-assets/SHA256SUMS.txt", hashes.join("\n") + "\n");
