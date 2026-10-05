import { readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const platform = process.argv[2];
const root =
  platform === "android"
    ? "desktop/gen/android/app/build/outputs"
    : "desktop/gen/apple/build";
const extension = platform === "android" ? /\.(apk|aab)$/ : /\.ipa$/;
mkdirSync("release-assets", { recursive: true });
let count = 0;
function collect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) collect(path);
    else if (extension.test(item.name)) {
      copyFileSync(
        path,
        join("release-assets", `easy-erp-${platform}-${item.name}`),
      );
      count++;
    }
  }
}
collect(root);
if (!count)
  throw new Error(`No ${platform} installation packages were produced.`);
