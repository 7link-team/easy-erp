import { readFileSync, writeFileSync } from "node:fs";

// Tauri's archive invocation may omit -sdk. Constrain this disposable project
// to the simulator so Xcode cannot select the default iPhoneOS SDK.
const path = "desktop/gen/apple/project.yml";
const source = readFileSync(path, "utf8");
const marker = "        ENABLE_BITCODE: false";
if (!source.includes(marker)) throw new Error("iOS template changed: missing build settings.");
writeFileSync(path, source.replace(marker, `${marker}
        SDKROOT: iphonesimulator
        SUPPORTED_PLATFORMS: iphonesimulator
        CODE_SIGNING_ALLOWED: false`));
