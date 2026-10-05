import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, Settings2 } from "lucide-react";
import { Button, Modal, useConfirm } from "./ui";
import { Notice } from "./components";
import { nativeBrowser } from "./browserLogin";

interface NativeInfo {
  version: string;
  enabled: boolean;
  mobile: boolean;
}
interface Update {
  version?: string;
  notes?: string;
  enabled?: boolean;
  current?: boolean;
  skipped?: boolean;
}
type Phase = "idle" | "checking" | "downloading" | "ready" | "installing";

export function NativeTools({ dirty }: { dirty: RefObject<boolean> }) {
  const [info, setInfo] = useState<NativeInfo>();
  const [update, setUpdate] = useState<Update>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    downloaded: number;
    total?: number;
  }>();
  const initialized = useRef(false);
  const confirm = useConfirm();
  const native = nativeBrowser();
  const busy = ["checking", "downloading", "installing"].includes(phase);

  async function check(automatic: boolean) {
    if (!native) return;
    setPhase("checking");
    setError("");
    try {
      const next = (await native.invoke("check_update", {
        automatic,
      })) as Update;
      if (next?.skipped) return;
      setUpdate(next);
      if (next?.version || !automatic) setOpen(true);
    } catch (e) {
      if (!automatic) setError(String(e));
    } finally {
      setPhase("idle");
    }
  }
  useEffect(() => {
    if (!native || initialized.current) return;
    initialized.current = true;
    void native
      .invoke("update_info", {})
      .then((value) => {
        const details = value as NativeInfo | undefined;
        if (!details?.version) return;
        setInfo(details);
        if (details.enabled && !details.mobile) void check(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const listener = (event: Event) =>
      setProgress((event as CustomEvent).detail);
    window.addEventListener("erp:update-progress", listener);
    return () => window.removeEventListener("erp:update-progress", listener);
  }, []);

  async function download() {
    setPhase("downloading");
    setError("");
    setProgress(undefined);
    try {
      await native!.invoke("download_update", {});
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }
  async function install() {
    if (dirty.current) {
      setError("还有未提交的收发内容，请先完成或取消当前操作，再安装更新。");
      return;
    }
    if (
      !(await confirm({
        title: "安装更新并重启？",
        description:
          "若这台电脑保存库存，应用会先备份并暂停库存服务，同事会短暂无法操作。请先通知同事保存内容。",
        confirmLabel: "备份并安装更新",
      }))
    )
      return;
    if (dirty.current) {
      setError("请先处理未提交的内容。");
      return;
    }
    setPhase("installing");
    setError("");
    try {
      await native!.invoke("install_update", {});
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }
  async function connection() {
    if (
      dirty.current &&
      !(await confirm({
        title: "更换库存电脑？",
        description: "当前未提交的内容不会保存。",
        confirmLabel: "确认离开",
      }))
    )
      return;
    try {
      await native!.invoke("mobile_disconnect", {});
    } catch (e) {
      setError(String(e));
      setOpen(true);
    }
  }
  if (!info) return null;
  return (
    <>
      <Button
        className="icon-button"
        aria-label={info.mobile ? "连接设置" : "检查应用更新"}
        title={
          info.mobile
            ? "连接设置"
            : update?.version
              ? `发现新版本 ${update.version}`
              : "检查应用更新"
        }
        onClick={() => {
          if (info.mobile) {
            void connection();
            return;
          }
          setOpen(true);
          if (phase === "idle" && !update?.version && info.enabled)
            void check(false);
        }}
      >
        {info.mobile ? <Settings2 size={19} /> : <Download size={19} />}
      </Button>
      {open && (
        <Modal
          title={info.mobile ? "连接设置" : "应用更新"}
          onClose={() => {
            if (phase !== "installing") setOpen(false);
          }}
        >
          <p>当前版本：{info.version}</p>
          {update?.version && (
            <>
              <h3>发现新版本 {update.version}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {update.notes || "本次更新包含功能改进和问题修复。"}
              </p>
            </>
          )}
          {!info.enabled && !info.mobile && (
            <p>
              此安装包未启用自动更新，或当前安装方式不支持。请从发布页面下载新版本安装包。
            </p>
          )}
          {update?.current && <p role="status">已经是最新版本。</p>}
          {phase === "checking" && <p role="status">正在检查新版本…</p>}
          {phase === "downloading" && (
            <div role="status">
              <p>正在下载并验证更新，不影响当前库存操作。</p>
              <progress
                aria-label="更新下载进度"
                max={progress?.total || 1}
                value={progress?.total ? progress.downloaded : undefined}
              />
              <p>
                {progress
                  ? `已下载 ${(progress.downloaded / 1024 / 1024).toFixed(1)} MB`
                  : "正在连接下载服务器…"}
              </p>
            </div>
          )}
          {phase === "ready" && (
            <p role="status">下载完成，签名验证通过。可以稍后安装。</p>
          )}
          {phase === "installing" && (
            <p role="status">正在备份、停止服务并安装更新，请勿关闭电脑。</p>
          )}
          {error && <Notice>{error}</Notice>}
          <div className="form-actions">
            {phase !== "installing" && (
              <Button onClick={() => setOpen(false)}>稍后再说</Button>
            )}
            {info.enabled && !update?.version && (
              <Button
                className="button primary"
                disabled={busy}
                onClick={() => void check(false)}
              >
                检查更新
              </Button>
            )}
            {update?.version && phase !== "ready" && (
              <Button
                className="button primary"
                disabled={busy}
                onClick={() => void download()}
              >
                下载更新
              </Button>
            )}
            {phase === "ready" && (
              <Button className="button primary" onClick={() => void install()}>
                安装并重启
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
