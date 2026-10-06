import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { releasePolicy } from "../release-channel.mjs";

const script = resolve("scripts/release-manifest.mjs");
const names = [
  "x86_64-pc-windows-msvc.exe",
  "x86_64-apple-darwin.tar.gz",
  "aarch64-apple-darwin.tar.gz",
  "x86_64-unknown-linux-gnu.AppImage",
];
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "easy-erp-manifest-test-"));
  mkdirSync(join(directory, "desktop"));
  mkdirSync(join(directory, "release-assets"));
  writeFileSync(
    join(directory, "desktop/tauri.conf.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  for (const name of names) {
    writeFileSync(
      join(directory, "release-assets", `easy-erp-${name}`),
      "fixture installer",
    );
    writeFileSync(
      join(directory, "release-assets", `easy-erp-${name}.sig`),
      "fixture signature",
    );
  }
  const build = (tag = "v0.1.0") =>
    spawnSync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        RELEASE_TAG: tag,
        RELEASE_REPOSITORY: "example/releases",
      },
      encoding: "utf8",
    });
  try {
    run(directory, build);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test("release requires matching version and every desktop binary/signature", () => {
  fixture((directory, build) => {
    assert.notEqual(build("v0.2.0").status, 0);
    assert.equal(
      existsSync(join(directory, "release-assets/latest.json")),
      false,
    );
    rmSync(join(directory, "release-assets", `easy-erp-${names[0]}`));
    assert.notEqual(build().status, 0);
    assert.equal(
      existsSync(join(directory, "release-assets/latest.json")),
      false,
    );
  });
});
test("release manifest maps architectures and includes manifest checksum", () => {
  fixture((directory, build) => {
    const result = build();
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      readFileSync(join(directory, "release-assets/latest.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.match(
      manifest.platforms["darwin-aarch64"].url,
      /\/v0\.1\.0\/easy-erp-aarch64-apple-darwin\.tar\.gz$/,
    );
    assert.match(
      readFileSync(join(directory, "release-assets/SHA256SUMS.txt"), "utf8"),
      /^[a-f0-9]{64}  latest\.json$/m,
    );
  });
});

test("release channel follows SemVer and rejects mismatched or invalid versions", () => {
  assert.deepEqual(releasePolicy("v1.2.0", "1.2.0"), {
    channel: "stable",
    prerelease: false,
  });
  for (const version of ["1.2.0-beta.1", "1.2.0-rc.2", "1.2.0-alpha.3+build.1"])
    assert.deepEqual(releasePolicy(`v${version}`, version), {
      channel: "preview",
      prerelease: true,
    });
  assert.equal(
    releasePolicy("v1.2.0+build.1", "1.2.0+build.1").channel,
    "stable",
  );
  for (const version of ["1.2", "01.2.0", "1.2.0-beta.01", "1.2.0-", "random"])
    assert.throws(() => releasePolicy(`v${version}`, version));
  assert.throws(() => releasePolicy("v1.2.0", "1.2.0-rc.1"));
});

test("prerelease manifests identify preview channel and use immutable version URLs", () => {
  fixture((directory, build) => {
    writeFileSync(
      join(directory, "desktop/tauri.conf.json"),
      JSON.stringify({ version: "0.2.0-rc.1" }),
    );
    const result = build("v0.2.0-rc.1");
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      readFileSync(join(directory, "release-assets/latest.json"), "utf8"),
    );
    assert.equal(manifest.channel, "preview");
    assert.match(manifest.platforms["darwin-x86_64"].url, /\/v0\.2\.0-rc\.1\//);
  });
});
