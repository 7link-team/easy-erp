import { writeFileSync } from "node:fs";

const signed = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
const pubkey = process.env.UPDATER_PUBLIC_KEY;
const endpoint = process.env.UPDATER_ENDPOINT;
if (signed && (!pubkey || !endpoint)) {
  throw new Error("Signed builds require UPDATER_PUBLIC_KEY and UPDATER_ENDPOINT repository variables.");
}
if (endpoint && !endpoint.startsWith("https://")) throw new Error("Updater endpoint must use HTTPS.");
const config = {
  bundle: {
    createUpdaterArtifacts: signed,
    windows: { nsis: { languages: ["SimpChinese"], installMode: "currentUser" } },
  },
  ...(signed ? { plugins: { updater: { pubkey, endpoints: [endpoint] } } } : {}),
};
writeFileSync("desktop/updater-build.json", JSON.stringify(config, null, 2));
console.log(signed ? "Signed updater build enabled." : "Installer build only; updater signing is not configured.");
