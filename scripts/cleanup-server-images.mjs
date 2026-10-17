import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const { IMAGE, PACKAGE_OWNER, PACKAGE_NAME, IMAGE_MAINTENANCE } = process.env;
assert.ok(["audit", "cleanup"].includes(IMAGE_MAINTENANCE));
assert.ok(IMAGE && PACKAGE_OWNER && PACKAGE_NAME);
const endpoint = `/orgs/${encodeURIComponent(PACKAGE_OWNER)}/packages/container/${encodeURIComponent(PACKAGE_NAME)}/versions`;
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const versions = () =>
  JSON.parse(gh("api", endpoint, "--paginate", "--slurp")).flat();
const tags = (version) => version.metadata.container.tags;
const shaOnly = (version) =>
  tags(version).length > 0 &&
  tags(version).every((tag) => /^sha-[a-f0-9]{40}(-(amd64|arm64))?$/.test(tag));
const manifest = (digest) => {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return JSON.parse(
    execFileSync("docker", ["buildx", "imagetools", "inspect", `${IMAGE}@${digest}`, "--raw"], { encoding: "utf8" }),
  );
};

function referencedDigests(list) {
  // Preserve every non-SHA tag and its complete multi-architecture dependency tree.
  const roots = list.filter((v) => tags(v).length && !shaOnly(v));
  assert.ok(roots.length, "No named versions found; refusing cleanup");
  const protectedDigests = new Set();
  const visit = (digest) => {
    if (protectedDigests.has(digest)) return;
    protectedDigests.add(digest);
    for (const child of manifest(digest).manifests ?? []) visit(child.digest);
  };
  for (const root of roots) visit(root.name);
  return protectedDigests;
}

const before = versions();
const protectedDigests = referencedDigests(before);
const candidates = before.filter((v) => shaOnly(v) && !protectedDigests.has(v.name));
console.log(JSON.stringify({
  mode: IMAGE_MAINTENANCE,
  delete: candidates.map((v) => ({ id: v.id, digest: v.name, tags: tags(v) })),
  retain: before.filter((v) => !candidates.includes(v)).map((v) => ({ id: v.id, digest: v.name, tags: tags(v) })),
}, null, 2));

if (IMAGE_MAINTENANCE === "cleanup") {
  for (const candidate of candidates) {
    // Recheck named roots and dependencies before each deletion.
    const current = versions();
    const live = current.find((v) => v.id === candidate.id);
    if (!live) continue;
    assert.equal(live.name, candidate.name);
    assert.ok(shaOnly(live), "Version acquired a non-SHA tag; refusing deletion");
    assert.ok(!referencedDigests(current).has(live.name), "Version is now referenced; refusing deletion");
    gh("api", "--method", "DELETE", `${endpoint}/${live.id}`);
    console.log(`Deleted obsolete SHA version ${live.id}`);
  }
  const after = versions();
  for (const retained of before.filter((v) => protectedDigests.has(v.name))) {
    const live = after.find((v) => v.id === retained.id);
    assert.ok(live, "Protected package version is missing");
    for (const tag of tags(retained)) assert.ok(tags(live).includes(tag), "Protected tag is missing");
  }
  referencedDigests(after); // Fetch every retained manifest again to verify it remains resolvable.
  console.log("Cleanup verified: named versions and all referenced manifests retained.");
}
