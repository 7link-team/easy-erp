import { Input, Button } from "./ui";
import { useState } from "react";
import { ExternalLink, Copy, RefreshCw } from "lucide-react";
import { Loading, Modal, Notice, useResource } from "./components";
import { nativeBrowser, openDesktopBrowser } from "./browserLogin";

export default function WebAccess({ onClose }: { onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [openError, setOpenError] = useState("");
  const [opening, setOpening] = useState(false);
  const { data, error, loading } = useResource<{
    items: { ip: string; local: boolean }[];
    port: number;
  }>("/web-addresses", revision);
  const current = new URL(window.location.origin);
  const addresses = new Map<string, string>([[current.href, "当前连接地址"]]);
  for (const item of data?.items ?? []) {
    const address = new URL(`http://${item.ip}:${data!.port}/`);
    addresses.set(
      address.href,
      item.local ? "仅库存电脑本机可用" : "其他设备可尝试此地址",
    );
  }
  return (
    <Modal title="在 Web 中打开" onClose={onClose}>
      <p>选择地址在浏览器中打开，也可以复制给同一局域网的电脑或手机。</p>
      <p className="hint">
        桌面版点击“打开”会以当前账号自动登录。复制链接给其他人时，对方需要自行登录。打不开时，请检查网络和库存电脑的防火墙。
      </p>
      {loading && <Loading />}
      {error && <Notice>{error}</Notice>}
      {openError && <Notice>{openError}</Notice>}
      <div className="web-address-list">
        {[...addresses].map(([address, label]) => (
          <section className="web-address" key={address}>
            <label>
              <span>{label}</span>
              <Input
                aria-label={`${label}链接`}
                name="web-address"
                type="url"
                spellCheck={false}
                readOnly
                value={address}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="row-actions">
              <a
                className="button primary"
                href={address}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={opening}
                onClick={async (event) => {
                  const native = nativeBrowser();
                  if (!native) return;
                  event.preventDefault();
                  if (opening) return;
                  setOpening(true);
                  setOpenError("");
                  setMessage("");
                  try {
                    await openDesktopBrowser(address);
                    setMessage("已交给系统默认浏览器打开。");
                  } catch (error) {
                    setOpenError(
                      `打开浏览器失败：${String(error)}。也可以复制链接到浏览器打开。`,
                    );
                  } finally {
                    setOpening(false);
                  }
                }}
              >
                <ExternalLink aria-hidden="true" size={16} />
                打开
              </a>
              <Button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(address);
                    setMessage(`已复制：${address}`);
                  } catch {
                    setMessage(
                      "浏览器不允许自动复制，请点击上方地址选中文字后复制。",
                    );
                  }
                }}
              >
                <Copy aria-hidden="true" size={16} />
                复制链接
              </Button>
            </div>
          </section>
        ))}
      </div>
      {data && !data.items.some((item) => !item.local) && (
        <p className="hint">
          服务当前没有可用的局域网 IPv4
          地址。请检查网络连接；独立部署的服务还需开启局域网监听。
        </p>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      <div className="form-actions form-footer">
        <Button
          className="button"
          disabled={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw aria-hidden="true" size={16} />
          刷新地址
        </Button>
      </div>
    </Modal>
  );
}
