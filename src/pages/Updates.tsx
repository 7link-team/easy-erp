import { useEffect } from "react";
import { Download, RefreshCw, ShieldCheck, PackageCheck } from "lucide-react";
import { useAppUpdates, UpdateRoutes, UpdateChannel } from "../NativeTools";
import { Notice, useResource } from "../components";
import { Button } from "../ui";
import "./updates.css";

export default function Updates() {
  const {
    info,
    update,
    phase,
    setOpen,
    error,
    progress,
    busy,
    check,
    download,
    install,
  } = useAppUpdates();
  const service = useResource<{ version: string }>("/status", 0);
  useEffect(() => {
    setOpen(false);
  }, [setOpen]);
  const supported = info?.enabled && !info.mobile;
  const status =
    phase === "checking"
      ? "正在检查新版本…"
      : phase === "downloading"
        ? "正在下载更新…"
        : phase === "installing"
          ? "正在安装，请勿关闭电脑"
          : phase === "ready"
            ? "更新已就绪"
            : error
              ? "更新未完成"
              : update?.version
                ? `发现新版本 ${update.version}`
                : update?.current
                  ? "当前渠道暂无更高版本"
                  : supported
                    ? "随时检查，方便时更新"
                    : info?.mobile
                      ? "移动端版本"
                      : info
                        ? "当前安装方式需手动更新"
                        : "Web 版本";
  return (
    <div className="updates-page">
      <div className="page-heading">
        <div>
          <h1>版本</h1>
          <p>查看当前版本，选择合适的时间更新。</p>
        </div>
      </div>
      <section className="update-overview" aria-label="当前版本">
        <div className="update-app-icon">
          <PackageCheck size={28} aria-hidden="true" />
        </div>
        <div>
          <span>
            库存管理 · {info ? (info.mobile ? "移动端" : "桌面端") : "Web 端"}
          </span>
          <h2>{info?.version || service.data?.version || "正在读取版本…"}</h2>
          <p>{info ? "当前应用版本" : "当前库存服务版本"}</p>
        </div>
      </section>
      <section className="panel update-details" aria-busy={busy}>
        <h2 aria-live="polite">{status}</h2>
        {supported ? (
          <>
            <p className="muted">
              自动检查新版本；下载和安装由你决定。离开此页后，本次下载仍会继续。
            </p>
            {error && <Notice>{error}</Notice>}
            <UpdateChannel />
            <UpdateRoutes />
            {phase === "downloading" && (
              <div className="update-progress" role="status">
                {progress?.fallback && (
                  <p>代理下载未成功，已自动切换到 GitHub 直连。</p>
                )}
                <progress
                  aria-label="更新下载进度"
                  max={progress?.total || 1}
                  value={progress?.total ? progress.downloaded : undefined}
                />
                <p>
                  {progress
                    ? `已下载 ${(progress.downloaded / 1024 / 1024).toFixed(1)} MB${progress.total ? ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ""}`
                    : "正在连接下载服务器…"}
                </p>
              </div>
            )}
            {phase === "ready" && (
              <p>下载完成，签名验证通过。可以现在安装，也可以稍后回来继续。</p>
            )}
            {phase === "installing" && (
              <p>
                正在备份、停止本机库存服务并安装更新，完成后应用将重新打开。
              </p>
            )}
            <div className="update-actions">
              {phase === "ready" ? (
                <Button
                  className="button primary"
                  onClick={() => void install()}
                >
                  <PackageCheck size={18} />
                  安装并重启
                </Button>
              ) : (
                update?.version && (
                  <Button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void download()}
                  >
                    <Download size={18} />
                    {phase === "downloading" ? "正在下载…" : "下载更新"}
                  </Button>
                )
              )}
              {phase !== "ready" && (
                <Button
                  className={update?.version ? "button" : "button primary"}
                  disabled={busy}
                  onClick={() => void check(false)}
                >
                  <RefreshCw size={18} />
                  {phase === "checking" ? "正在检查…" : "检查更新"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p>
              {info?.mobile
                ? "移动端请通过原安装渠道更新。本页不安装桌面端更新包。"
                : info
                  ? "此安装包未启用自动更新，请从 GitHub 发布页面下载适合这台电脑的安装包。"
                  : "Web 页面由库存电脑提供。请在保存库存的电脑上更新应用或服务，再刷新本页。"}
            </p>
            {service.error && <Notice>{service.error}</Notice>}
            {!info && (
              <Button onClick={() => location.reload()}>
                <RefreshCw size={18} />
                刷新页面
              </Button>
            )}
          </>
        )}
      </section>
      {supported && update?.version && (
        <section className="panel update-notes">
          <h2>新版内容 · {update.version}</h2>
          <p>{update.notes || "本次更新包含功能改进和问题修复。"}</p>
        </section>
      )}
      {supported && (
        <div className="update-safety">
          <ShieldCheck size={21} aria-hidden="true" />
          <p>
            安装前会备份本机库存数据。若此电脑保存库存，安装期间同事会短暂无法操作，请先通知大家保存内容。仅连接其他库存电脑时，不会停止对方的服务。
          </p>
        </div>
      )}
    </div>
  );
}
