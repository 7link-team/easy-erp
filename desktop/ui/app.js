const { invoke } = window.__TAURI__.core;
const status = document.querySelector("#status");
const address = document.querySelector("#address");
let busy = false;
async function run(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  status.textContent = "正在打开库存管理…";
  try {
    await task();
    status.textContent = "";
  } catch (error) {
    status.textContent = String(error);
    await invoke("show_launcher");
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
  }
}
document
  .querySelector("#local")
  .addEventListener("click", () => run(() => invoke("start_local")));
document
  .querySelector("#connect")
  .addEventListener("click", () =>
    run(() => invoke("connect_host", { address: address.value })),
  );
document
  .querySelector("#retry")
  .addEventListener("click", () => run(() => invoke("resume_last")));
document
  .querySelector("#browser")
  .addEventListener("click", () => run(() => invoke("open_browser")));
address.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.querySelector("#connect").click();
});
document
  .querySelector("#autostart")
  .addEventListener("change", async (event) => {
    try {
      await invoke("set_autostart", { enabled: event.target.checked });
    } catch (error) {
      event.target.checked = !event.target.checked;
      status.textContent = String(error);
    }
  });
window.__TAURI__.event.listen("startup-error", (event) => {
  status.textContent = event.payload;
});
async function initialize() {
  try {
    const preferences = await invoke("connection_settings");
    address.value = preferences.server_url;
    document.querySelector("#autostart").checked = preferences.autostart;
    if (preferences.mode) {
      const badge = document.querySelector("#saved-mode");
      badge.hidden = false;
      badge.textContent =
        preferences.mode === "local"
          ? "已记住：保存在本机"
          : "已记住：连接已有库存电脑";
      document.querySelector("#saved-actions").hidden = false;
      await run(() => invoke("resume_last"));
    } else await invoke("show_launcher");
  } catch (error) {
    status.textContent = String(error);
    await invoke("show_launcher");
  }
}
initialize();

const recovery = document.querySelector("#recovery");
const recoveryAction = document.querySelector("#recovery-action");
const recoveryConfirm = document.querySelector("#recovery-confirm");
const recoveryBackup = document.querySelector("#recovery-backup");
const recoveryStatus = document.querySelector("#recovery-status");
let recoveryBusy = false;
let recoveryLoaded = false;
let externalBackup = "";
let backups = [];
const recoveryActions = {
  reset: {
    phrase: "清空全部数据",
    description:
      "清空数据（不含备份数据）：删除本机全部业务数据、图片、账号与设置，恢复到首次使用状态。现有备份会保留。此操作不可撤销。",
  },
  restore: {
    phrase: "恢复全部数据",
    description:
      "用所选备份替换本机全部数据，包括业务、图片、账号与设置。当前数据将被覆盖，请确认备份时间与来源。",
  },
  "clear-backups": {
    phrase: "清空全部备份",
    description:
      "仅删除本机备份目录中的全部备份，不可恢复。现有业务数据、图片、账号与设置不变，不会删除远程主机的备份。",
  },
};
function updateRecovery() {
  const action = recoveryActions[recoveryAction.value];
  document.querySelector("#recovery-description").textContent =
    action.description;
  document.querySelector("#recovery-source").hidden =
    recoveryAction.value !== "restore";
  document.querySelector("#recovery-confirm-label").textContent =
    `输入“${action.phrase}”确认`;
  document.querySelector("#recovery-submit").disabled =
    recoveryBusy ||
    !recoveryLoaded ||
    recoveryConfirm.value !== action.phrase ||
    (recoveryAction.value === "restore" &&
      !(externalBackup || recoveryBackup.value));
}
function setRecoveryBusy(value) {
  recoveryBusy = value;
  recovery.setAttribute("aria-busy", String(value));
  recovery.querySelectorAll("button, input, select").forEach((control) => {
    control.disabled = value;
  });
  updateRecovery();
}
function formatBackupTime(backup) {
  const timestamp = backup.snapshot_at ?? backup.created_at;
  const date = new Date(timestamp ?? NaN);
  const time = Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
  return time;
}
async function loadRecovery() {
  if (recoveryBusy) return;
  setRecoveryBusy(true);
  recoveryStatus.textContent = "正在读取本机备份…";
  recoveryLoaded = false;
  try {
    const info = await invoke("recovery_list");
    document.querySelector("#recovery-data-dir").textContent = info.data_dir;
    document.querySelector("#recovery-backups-dir").textContent =
      info.backups_dir;
    document.querySelector("#recovery-remote").hidden = !info.remote_mode;
    backups = info.items || [];
    recoveryBackup.replaceChildren(
      new Option(
        backups.length
          ? "请选择备份"
          : "没有本机备份，可选择 ZIP 或旧版备份文件",
        "",
      ),
    );
    for (const backup of backups) {
      const time = formatBackupTime(backup);
      recoveryBackup.add(
        new Option(
          `${backup.name} · ${time}${backup.metadata_error ? " · 元数据异常" : ""}`,
          backup.path,
        ),
      );
    }
    externalBackup = "";
    document.querySelector("#recovery-external").textContent = "";
    document.querySelector("#recovery-backup-detail").textContent = "";
    recoveryLoaded = true;
    recoveryStatus.textContent = "";
  } catch (error) {
    recoveryStatus.textContent = `无法读取本机维护信息：${error}`;
  } finally {
    setRecoveryBusy(false);
  }
}
async function openRecovery() {
  if (busy || recoveryBusy) return;
  recoveryConfirm.value = "";
  document.querySelector("#recovery-restart").checked = false;
  if (!recovery.open) recovery.showModal();
  await loadRecovery();
  recoveryAction.focus();
}
document.querySelector("#maintenance").addEventListener("click", openRecovery);
window.__TAURI__.event.listen("open-recovery", openRecovery);
recovery.addEventListener("close", () => {
  document.querySelector("#maintenance").focus();
});
recovery.addEventListener("focusin", (event) => {
  event.target.scrollIntoView({ block: "nearest" });
});
recovery.addEventListener("cancel", (event) => {
  if (recoveryBusy) event.preventDefault();
});
document.querySelector("#recovery-close").addEventListener("click", () => {
  if (!recoveryBusy) recovery.close();
});
document
  .querySelector("#recovery-refresh")
  .addEventListener("click", loadRecovery);
recoveryAction.addEventListener("change", () => {
  recoveryConfirm.value = "";
  recoveryStatus.textContent = "";
  updateRecovery();
});
recoveryConfirm.addEventListener("input", updateRecovery);
recoveryBackup.addEventListener("change", () => {
  externalBackup = "";
  document.querySelector("#recovery-external").textContent = "";
  const backup = backups.find((item) => item.path === recoveryBackup.value);
  document.querySelector("#recovery-backup-detail").textContent = backup
    ? `${backup.path} · ${formatBackupTime(backup)} · ${new Intl.NumberFormat().format(backup.size || 0)} 字节${backup.metadata_error ? " · 备份元数据读取失败，恢复时将重新校验" : ""}`
    : "";
  updateRecovery();
});
document.querySelector("#recovery-pick").addEventListener("click", async () => {
  if (recoveryBusy) return;
  setRecoveryBusy(true);
  try {
    const path = await invoke("recovery_select_backup");
    if (path) {
      externalBackup = path;
      recoveryBackup.value = "";
      document.querySelector("#recovery-backup-detail").textContent = "";
      document.querySelector("#recovery-external").textContent =
        `已选择：${path}`;
    }
  } catch (error) {
    recoveryStatus.textContent = String(error);
  } finally {
    setRecoveryBusy(false);
  }
});
document
  .querySelector("#recovery-submit")
  .addEventListener("click", async () => {
    if (recoveryBusy || document.querySelector("#recovery-submit").disabled)
      return;
    const args = {
      action: recoveryAction.value,
      confirmation: recoveryConfirm.value,
      backup:
        recoveryAction.value === "restore"
          ? externalBackup || recoveryBackup.value
          : null,
      restart: document.querySelector("#recovery-restart").checked,
    };
    setRecoveryBusy(true);
    recoveryStatus.textContent =
      "正在安全停止本机服务并执行维护，请勿退出应用…";
    try {
      const result = await invoke("recovery_execute", args);
      const notes = [
        result.message,
        ...(Array.isArray(result.warnings) ? result.warnings : []),
      ];
      if (result.previous_data)
        notes.push(`原数据保护副本：${result.previous_data}`);
      recoveryStatus.textContent = `${result.started ? "维护完成，本机库存管理已启动。" : "维护完成，本机服务保持停止。可继续维护，或关闭此窗口后点击“使用本机并进入库存管理”手动启动。"}${notes.filter(Boolean).join("；")}`;
      recoveryConfirm.value = "";
      // A new listing is required before another destructive operation.
      recoveryLoaded = false;
    } catch (error) {
      recoveryStatus.textContent = String(error);
    } finally {
      setRecoveryBusy(false);
    }
  });
