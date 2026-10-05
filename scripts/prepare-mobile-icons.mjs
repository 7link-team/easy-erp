import { cpSync, existsSync } from "node:fs";

const platform = process.argv[2];
const destinations = {
  android: "desktop/gen/android/app/src/main/res",
  ios: "desktop/gen/apple/Assets.xcassets/AppIcon.appiconset",
};
const destination = destinations[platform];
if (!destination || !existsSync(destination))
  throw new Error("Initialize the mobile project before copying application icons.");
// Mobile init creates Tauri placeholder icons even when desktop icons exist.
// Keep the generated asset manifest, replacing images with our existing brand.
cpSync(`desktop/icons/${platform}`, destination, { recursive: true });
