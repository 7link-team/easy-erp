import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("update commands have generated permissions for launcher and inventory windows", () => {
  const build = readFileSync("desktop/build.rs", "utf8");
  const desktop = readFileSync("desktop/src/desktop.rs", "utf8");
  const launcher = JSON.parse(readFileSync("desktop/capabilities/launcher.json", "utf8"));
  const remote = JSON.parse(desktop.match(/"permissions":\s*(\[[^\]]+\])/)[1]);
  for (const command of ["update_info", "check_update", "set_update_channel", "download_update", "install_update"]) {
    const permission = `allow-${command.replaceAll("_", "-")}`;
    assert.ok(build.includes(`"${command}"`), `permission generation missing: ${command}`);
    assert.ok(desktop.includes(`updates::${command}`), `command handler missing: ${command}`);
    assert.ok(launcher.permissions.includes(permission), `launcher permission missing: ${permission}`);
    assert.ok(remote.includes(permission), `inventory permission missing: ${permission}`);
  }
});
