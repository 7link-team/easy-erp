import { send, type User } from "./api";

export function nativeBrowser() {
  return (
    window as Window & {
      __TAURI__?: {
        core: {
          invoke: (
            command: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
    }
  ).__TAURI__?.core;
}

export async function openDesktopBrowser(
  address: string,
  authenticated = true,
) {
  const native = nativeBrowser();
  if (!native) throw new Error("请在桌面版中使用此操作。");
  const url = new URL(address);
  if (authenticated) {
    const { ticket } = await send<{ ticket: string }>("/browser-login", {
      target: url.origin,
    });
    url.hash = `/browser-login/${ticket}`;
  }
  await native.invoke("open_web_address", { address: url.href });
}

// Capture and clear before React navigation runs. One promise also prevents
// development StrictMode from redeeming a single-use link twice.
const match = location.hash.match(/^#\/browser-login\/([a-f0-9]{64})$/);
if (match)
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#/home`,
  );
export const browserLogin = match
  ? send<{ user: User }>("/browser-login/consume", { ticket: match[1] })
      .then((result) => ({ user: result.user, error: "" }))
      .catch((error: Error) => ({ user: undefined, error: error.message }))
  : undefined;
