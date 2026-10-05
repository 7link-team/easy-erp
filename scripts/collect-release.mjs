import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const target = process.argv[2];
if (!/^[a-z0-9_-]+$/.test(target ?? ""))
  throw new Error("A target triple is required.");
const root = `desktop/target/${target}/release/bundle`;
mkdirSync("release-assets", { recursive: true });
let count = 0;
function collect(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      if (!item.name.endsWith(".app")) collect(path);
    } else if (/\.(dmg|exe|AppImage|deb|tar\.gz)(\.sig)?$/.test(item.name)) {
      const extension = item.name.match(
        /\.(dmg|exe|AppImage|deb|tar\.gz)(\.sig)?$/,
      )[0];
      const name = `easy-erp-${target}${extension}`;
      copyFileSync(path, join("release-assets", name));
      count++;
    }
  }
}
collect(root);
if (!count) throw new Error("No installers were produced.");
const binary = target.includes("windows")
  ? "easy-erp-server.exe"
  : "easy-erp-server";
execFileSync(
  "tar",
  [
    "-czf",
    `release-assets/easy-erp-server-${target}.tar.gz`,
    "-C",
    `target/${target}/release`,
    binary,
  ],
  { stdio: "inherit" },
);
console.log(`Collected ${count} assets for ${target}.`);
