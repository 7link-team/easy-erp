const { invoke } = window.__TAURI__.core;
const status = document.querySelector("#status");
const address = document.querySelector("#address");
let busy = false;
let databaseConfigured = true;
const storageNames = { local: "本地文件", s3: "S3 对象存储", legacy: "旧数据目录" };
const storageName = (kind) => (storageNames[kind] ? `${storageNames[kind]} ` : "");
const databaseForm = document.querySelector("#database-form");
const databaseKind = document.querySelector("#database-kind");
function showDatabaseState(configured) {
  databaseConfigured = configured;
  databaseForm.hidden = configured;
  document.querySelector("#database-saved").hidden = !configured;
  // Before anything is configured the stepper owns the window; afterwards the
  // launcher is just the entry point for an already configured machine.
  document.querySelector("#setup").hidden = configured;
  document.querySelector("#direct-entry").hidden = !configured;
  if (configured)
    for (const secret of [
      "#mysql-password",
      "#setup-mysql-password",
      "#setup-s3-secret-access-key",
    ])
      document.querySelector(secret).value = "";
}
async function startLocal(args) {
  try {
    await invoke("start_local", args);
  } catch (error) {
    // Configuration can be saved before the service fails to start. Keeping
    // that state means a retry reuses it instead of asking for it all again.
    const preferences = await invoke("connection_settings").catch(() => null);
    if (preferences?.database_configured === true) showDatabaseState(true);
    throw error;
  }
  showDatabaseState(true);
}
databaseKind.addEventListener("change", () => {
  const mysql = databaseKind.value === "mysql";
  document.querySelector("#mysql-fields").hidden = !mysql;
  for (const id of ["host", "port", "database", "username"]) {
    document.querySelector(`#mysql-${id}`).required = mysql;
  }
});
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
document.querySelector("#local").addEventListener("click", () => {
  if (!databaseConfigured && !databaseForm.reportValidity()) return;
  const kind = databaseKind.value;
  const database = databaseConfigured
    ? undefined
    : kind === "sqlite"
      ? { kind }
      : {
          kind,
          host: document.querySelector("#mysql-host").value,
          port: Number(document.querySelector("#mysql-port").value),
          database: document.querySelector("#mysql-database").value,
          username: document.querySelector("#mysql-username").value,
          password: document.querySelector("#mysql-password").value,
          tls: document.querySelector("#mysql-tls").checked,
        };
  run(() => startLocal({ database }));
});
databaseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#local").click();
});
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
    showDatabaseState(preferences.database_configured !== false);
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
let returnToInventory = false;
let externalBackup = "";
let backups = [];
let recoveryInfo;
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
      "删除本机配置的存储中的全部备份（包括已配置的 S3 对象存储），不可恢复。现有业务数据、图片、账号与设置不变。请核对存储位置，其他设备可能也在使用这些备份。",
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
function showPath(element, path, prefix = "") {
  const content = document.createElement("span");
  content.className = "file-location-content";
  if (prefix) {
    const label = document.createElement("strong");
    label.className = "file-location-label";
    label.textContent = prefix.replace(/：$/, "");
    content.append(label);
  }
  const value = document.createElement("code");
  value.className = "file-location-path";
  value.textContent = path;
  content.append(value);
  element.replaceChildren(content);
  element.classList.add("file-location");
  if (!path || path.startsWith("s3://")) {
    if (path)
      element.append(
        document.createTextNode("（对象存储，无法在本机文件管理器查看）"),
      );
    return;
  }
  const button = document.createElement("button");
  button.className = "secondary";
  button.textContent = "打开位置";
  button.setAttribute("aria-label", `在文件管理器中查看 ${path}`);
  button.addEventListener("click", async () => {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    recoveryStatus.textContent = "正在打开文件管理器…";
    try {
      await invoke("reveal_file", { path });
      recoveryStatus.textContent = "已请求打开文件管理器。";
    } catch (error) {
      recoveryStatus.textContent = String(error);
    } finally {
      setRecoveryBusy(false);
    }
  });
  element.append(button);
}

async function loadRecovery() {
  if (recoveryBusy) return;
  setRecoveryBusy(true);
  recoveryStatus.textContent = "正在读取本机备份…";
  recoveryLoaded = false;
  try {
    const info = await invoke("recovery_list");
    recoveryInfo = info;
    recoveryConfirm.value = "";
    showPath(document.querySelector("#recovery-data-dir"), info.data_dir, "本机数据");
    showPath(document.querySelector("#recovery-backups-dir"), info.backups_dir, "本机备份");
    const locations = document.querySelector("#recovery-locations");
    locations.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `本机数据库文件：${info.has_data ? "已存在" : "未找到"} · 备份：${(info.items || []).length} 份${info.pending ? " · 检测到未完成维护，请先核对状态" : ""}`;
    locations.append(summary);
    for (const storage of info.storage_locations || []) {
      for (const [label, path] of [
        ["备份", storage.backups],
        ["附件", storage.attachments],
      ]) {
        if (path === info.backups_dir) continue;
        const row = document.createElement("p");
        showPath(row, path, `${storageName(storage.kind)}${label}位置：`);
        locations.append(row);
      }
    }
    const files = await invoke("file_locations");
    for (const item of files?.details || []) {
      const row = document.createElement("p");
      row.className = "file-location";
      row.textContent = `${item.label}：${item.value}`;
      locations.append(row);
    }
    for (const item of files?.items || []) {
      if ([info.data_dir, info.backups_dir].includes(item.path)) continue;
      const row = document.createElement("p");
      showPath(row, item.path, `${item.label}：`);
      if (item.exists !== undefined) {
        const metadata = document.createElement("small");
        metadata.className = "file-location-meta";
        metadata.textContent = `${item.exists ? "已存在" : "尚未创建"}${item.size != null ? ` · ${item.size.toLocaleString()} 字节` : ""}${item.modified ? ` · 修改于 ${new Date(item.modified).toLocaleString("zh-CN")}` : ""}`;
        row.querySelector(".file-location-content").append(metadata);
      }
      locations.append(row);
    }
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
async function openRecovery(fromInventory = false) {
  if (busy || recoveryBusy) return;
  returnToInventory = fromInventory;
  recoveryConfirm.value = "";
  document.querySelector("#recovery-restart").checked = false;
  if (!recovery.open) recovery.showModal();
  await loadRecovery();
  recoveryAction.focus();
}
document.querySelector("#maintenance").addEventListener("click", () => openRecovery());
window.__TAURI__.event.listen("open-recovery", () => openRecovery(true));
recovery.addEventListener("close", async () => {
  const shouldReturn = returnToInventory;
  returnToInventory = false;
  if (shouldReturn) {
    try {
      if (await invoke("close_data_maintenance")) return;
    } catch (error) {
      status.textContent = `无法返回库存窗口：${error}`;
    }
  }
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
  recoveryConfirm.value = "";
  externalBackup = "";
  document.querySelector("#recovery-external").textContent = "";
  const backup = backups.find((item) => item.path === recoveryBackup.value);
  document.querySelector("#recovery-backup-detail").textContent = backup
    ? `${backup.path} · ${formatBackupTime(backup)} · ${new Intl.NumberFormat().format(backup.size || 0)} 字节${backup.metadata_error ? " · 备份元数据读取失败，恢复时将重新校验" : ""}`
    : "";
  if (backup) {
    const detail = document.querySelector("#recovery-backup-detail");
    const metadata = detail.textContent.slice(backup.path.length);
    showPath(detail, backup.path);
    detail.append(document.createTextNode(metadata));
  }
  updateRecovery();
});
document.querySelector("#recovery-pick").addEventListener("click", async () => {
  if (recoveryBusy) return;
  setRecoveryBusy(true);
  try {
    const path = await invoke("recovery_select_backup");
    if (path) {
      recoveryConfirm.value = "";
      externalBackup = path;
      recoveryBackup.value = "";
      document.querySelector("#recovery-backup-detail").textContent = "";
      showPath(document.querySelector("#recovery-external"), path, "已选择：");
    }
  } catch (error) {
    recoveryStatus.textContent = String(error);
  } finally {
    setRecoveryBusy(false);
  }
});
const finalDialog = document.querySelector("#recovery-final");
let finishFinal;
function cancelFinal() {
  finalDialog.close();
  finishFinal?.(null);
  finishFinal = undefined;
}
finalDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelFinal();
});
document
  .querySelector("#recovery-final-cancel")
  .addEventListener("click", cancelFinal);
document.querySelector("#recovery-final-next").addEventListener("click", () => {
  finalDialog.close();
  finishFinal?.(true);
  finishFinal = undefined;
});
function confirmRecovery(args) {
  document.querySelector("#recovery-final-warning").textContent =
    recoveryActions[args.action].description;
  document.querySelector("#recovery-final-target").textContent =
    `目标：这台电脑。数据目录：${recoveryInfo.data_dir}。备份存储：${recoveryInfo.backups_dir}。${(recoveryInfo.storage_locations || []).map((s) => `配置存储 ${storageName(s.kind).trim()}：备份 ${s.backups}；附件 ${s.attachments}`).join("；")}。${args.backup ? `恢复来源：${args.backup}。` : ""}${args.restart ? "完成后将启动本机服务。" : "完成后本机服务保持停止。"}`;
  document.querySelector("#recovery-final-review").hidden = false;
  return new Promise((resolve) => {
    finishFinal = resolve;
    finalDialog.showModal();
    document.querySelector("#recovery-final-cancel").focus();
  });
}

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
    const confirmed = await confirmRecovery(args);
    recoveryConfirm.value = "";
    if (!confirmed) {
      setRecoveryBusy(false);
      recoveryStatus.textContent = "已取消操作，未修改数据。";
      recoveryConfirm.focus();
      return;
    }
    recoveryStatus.textContent =
      "正在安全停止服务并执行维护，请勿退出应用…";
    try {
      const result = await invoke("recovery_execute", args);
      const notes = [
        result.message,
        ...(Array.isArray(result.warnings) ? result.warnings : []),
      ];
      if (result.previous_data)
        notes.push(`原数据保护副本：${result.previous_data}`);
      recoveryStatus.textContent = `${result.started ? "维护完成，本机库存管理已启动。" : "维护完成，本机服务保持停止。可继续维护，或关闭此窗口后点击“使用本机并进入库存管理”手动启动。"}${notes.filter(Boolean).join("；")}`;
      if (result.previous_data) {
        const row = document.createElement("p");
        showPath(row, result.previous_data, "原数据保护副本：");
        document.querySelector("#recovery-locations").append(row);
      }
      recoveryConfirm.value = "";
      // A new listing is required before another destructive operation.
      recoveryLoaded = false;
    } catch (error) {
      recoveryStatus.textContent = String(error);
    } finally {
      setRecoveryBusy(false);
    }
  });

// Initial setup stepper. Every choice is held in the form until the last step
// submits it in one call; nothing is written to disk before that.
const setupForm = document.querySelector("#setup-form");
const stepList = document.querySelector("#step-list");
const stepTitles = {
  mode: "运行模式",
  database: "数据库",
  storage: "文件存储",
  confirm: "确认",
};
const stepPanels = Object.fromEntries(
  [...setupForm.querySelectorAll(".step")].map((step) => [
    step.dataset.step,
    step,
  ]),
);
const modeNames = {
  local: "本机提供库存服务",
  client: "仅作为客户端",
  recovery: "从备份恢复",
};
const s3Presets = {
  aliyun: {
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    region: "oss-cn-hangzhou",
    path_style: false,
    allow_http: false,
  },
  minio: {
    endpoint: "http://192.168.1.20:9000",
    region: "us-east-1",
    path_style: true,
    allow_http: true,
  },
  aws: {
    endpoint: "",
    region: "us-east-1",
    path_style: false,
    allow_http: false,
  },
};
let stepIndex = 0;
let restoreBackup = "";

const field = (selector) => document.querySelector(selector);
const value = (selector) => field(selector).value.trim();
const checked = (selector) => field(selector).checked;
const setupMode = () =>
  setupForm.querySelector("input[name='mode']:checked").value;
const stepOrder = () =>
  setupMode() === "local"
    ? ["mode", "database", "storage", "confirm"]
    : ["mode", "confirm"];
// A disabled fieldset is skipped by native validation, so hiding a branch also
// stops it from blocking the step the user is actually on.
function enable(fieldset, active) {
  fieldset.hidden = !active;
  fieldset.disabled = !active;
}
function renderSteps(order) {
  stepList.replaceChildren(
    ...order.map((name, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${index + 1}. ${stepTitles[name]}`;
      // Earlier steps stay reachable; later ones need this one filled in first.
      button.disabled = index > stepIndex;
      if (index === stepIndex) button.setAttribute("aria-current", "step");
      button.addEventListener("click", () => {
        stepIndex = index;
        showStep();
      });
      item.append(button);
      return item;
    }),
  );
}
function summarize(list, term, detail) {
  const name = document.createElement("dt");
  name.textContent = term;
  const description = document.createElement("dd");
  description.textContent = detail;
  list.append(name, description);
}
function renderSummary() {
  const list = field("#setup-summary");
  list.replaceChildren();
  const mode = setupMode();
  summarize(list, "运行模式", modeNames[mode]);
  if (mode === "client")
    summarize(list, "库存电脑地址", value("#setup-address"));
  if (mode === "recovery")
    summarize(list, "备份文件", restoreBackup || "尚未选择备份文件");
  if (mode !== "local") return;
  summarize(
    list,
    "数据库",
    value("#setup-database-kind") === "sqlite"
      ? "本地 SQLite"
      : `MySQL · ${value("#setup-mysql-host")}:${value("#setup-mysql-port")}/${value("#setup-mysql-database")} · 用户 ${value("#setup-mysql-username")} · ${checked("#setup-mysql-tls") ? "TLS 加密" : "未加密"}`,
  );
  summarize(
    list,
    "文件存储",
    value("#setup-storage-backend") === "local"
      ? "本地目录"
      : `S3 · 桶 ${value("#setup-s3-bucket")} · 区域 ${value("#setup-s3-region") || "未填"} · 地址 ${value("#setup-s3-endpoint") || "默认"} · 前缀 ${value("#setup-s3-prefix") || "无"} · ${checked("#setup-s3-path-style") ? "路径寻址" : "虚拟主机寻址"}${checked("#setup-s3-allow-http") ? " · 允许 HTTP" : ""}`,
  );
}
function showStep() {
  const order = stepOrder();
  stepIndex = Math.min(stepIndex, order.length - 1);
  for (const [name, panel] of Object.entries(stepPanels))
    enable(panel, name === order[stepIndex]);
  const last = stepIndex === order.length - 1;
  field("#setup-back").hidden = stepIndex === 0;
  field("#setup-next").textContent = last ? "完成配置" : "下一步";
  if (last) renderSummary();
  renderSteps(order);
}
for (const mode of setupForm.querySelectorAll("input[name='mode']"))
  mode.addEventListener("change", () => {
    enable(field("#client-fields"), setupMode() === "client");
    enable(field("#restore-fields"), setupMode() === "recovery");
    showStep();
  });
field("#setup-database-kind").addEventListener("change", (event) =>
  enable(field("#setup-mysql"), event.target.value === "mysql"),
);
field("#setup-storage-backend").addEventListener("change", (event) =>
  enable(field("#setup-s3"), event.target.value === "s3"),
);
for (const preset of setupForm.querySelectorAll("input[name='s3-preset']"))
  preset.addEventListener("change", (event) => {
    const values = s3Presets[event.target.value];
    field("#setup-s3-endpoint").value = values.endpoint;
    field("#setup-s3-region").value = values.region;
    field("#setup-s3-path-style").checked = values.path_style;
    field("#setup-s3-allow-http").checked = values.allow_http;
  });
field("#setup-back").addEventListener("click", () => {
  stepIndex = Math.max(0, stepIndex - 1);
  showStep();
});
field("#setup-pick-backup").addEventListener("click", async () => {
  if (busy) return;
  try {
    const path = await invoke("recovery_select_backup");
    if (!path) return;
    restoreBackup = path;
    field("#setup-backup").textContent = `已选择：${path}`;
  } catch (error) {
    status.textContent = String(error);
  }
});
setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const order = stepOrder();
  if (stepIndex < order.length - 1) {
    stepIndex += 1;
    showStep();
    return;
  }
  const mode = setupMode();
  if (mode === "client")
    return run(() =>
      invoke("connect_host", { address: value("#setup-address") }),
    );
  if (mode === "recovery") {
    if (!restoreBackup) {
      status.textContent = "请先选择备份文件。";
      stepIndex = 0;
      showStep();
      return;
    }
    return run(() =>
      invoke("recovery_execute", {
        action: "restore",
        confirmation: recoveryActions.restore.phrase,
        backup: restoreBackup,
        restart: true,
      }),
    );
  }
  const kind = value("#setup-database-kind");
  const database =
    kind === "sqlite"
      ? { kind }
      : {
          kind,
          host: value("#setup-mysql-host"),
          port: Number(value("#setup-mysql-port")),
          database: value("#setup-mysql-database"),
          username: value("#setup-mysql-username"),
          password: field("#setup-mysql-password").value,
          tls: checked("#setup-mysql-tls"),
        };
  const backend = value("#setup-storage-backend");
  const storage = {
    backend,
    s3:
      backend === "s3"
        ? {
            bucket: value("#setup-s3-bucket"),
            region: value("#setup-s3-region"),
            endpoint: value("#setup-s3-endpoint"),
            prefix: value("#setup-s3-prefix"),
            access_key_id: value("#setup-s3-access-key-id"),
            secret_access_key: field("#setup-s3-secret-access-key").value,
            path_style: checked("#setup-s3-path-style"),
            allow_http: checked("#setup-s3-allow-http"),
          }
        : null,
  };
  run(() => startLocal({ database, storage }));
});
showStep();
