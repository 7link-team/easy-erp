const { invoke } = window.__TAURI__.core;
const address = document.querySelector("#address");
const status = document.querySelector("#status");
const button = document.querySelector("button");
async function run(command, args = {}) {
  button.disabled = true;
  status.textContent = "正在连接库存电脑…";
  try {
    await invoke(command, args);
    status.textContent = "";
  } catch (error) {
    status.textContent = String(error);
  } finally {
    button.disabled = false;
  }
}
document
  .querySelector("#mobile-connect")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    if (!address.value.trim()) {
      status.textContent = "请填写库存电脑地址。";
      address.focus();
      return;
    }
    void run("mobile_connect", { address: address.value });
  });
async function initialize() {
  try {
    const preferences = await invoke("mobile_settings");
    address.value = preferences.server_url;
    document.querySelector("#version").textContent =
      `版本 ${preferences.version}`;
    if (preferences.server_url && location.hash !== "#settings")
      await run("mobile_resume");
  } catch (error) {
    status.textContent = String(error);
  }
}
void initialize();
