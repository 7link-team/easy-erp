import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!/^[a-z0-9_-]+$/.test(target ?? "")) throw new Error("A target triple is required.");
const root = `desktop/target/${target}/release/bundle`;
mkdirSync("release-assets", { recursive: true });
let count = 0;
function collect(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      if (!item.name.endsWith(".app")) collect(path);
    } else if (/\.(dmg|exe|AppImage|deb|tar\.gz)(\.sig)?$/.test(item.name)) {
      const extension = item.name.match(/\.(dmg|exe|AppImage|deb|tar\.gz)(\.sig)?$/)[0];
      const name = `easy-erp-${target}${extension}`;
      copyFileSync(path, join("release-assets", name));
      count++;
    }
  }
}
collect(root);
if (!count) throw new Error("No installers were produced.");
console.log(`Collected ${count} assets for ${target}.`);
