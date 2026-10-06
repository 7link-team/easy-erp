import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function releasePolicy(tag, version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (
    !match ||
    match[4]
      ?.split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  )
    throw new Error("Release version must be valid SemVer.");
  if (tag !== `v${version}`)
    throw new Error(`Tag must match application version v${version}.`);
  const prerelease = Boolean(match[4]);
  return { channel: prerelease ? "preview" : "stable", prerelease };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const version = JSON.parse(
    readFileSync("desktop/tauri.conf.json", "utf8"),
  ).version;
  const policy = releasePolicy(process.env.RELEASE_TAG, version);
  console.log(`channel=${policy.channel}\nprerelease=${policy.prerelease}`);
}
