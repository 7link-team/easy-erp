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
