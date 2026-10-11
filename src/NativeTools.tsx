import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Download, Settings2 } from "lucide-react";
import { Button, Modal, Select, useConfirm } from "./ui";
import { Notice } from "./components";
import { nativeBrowser } from "./browserLogin";

interface NativeInfo {
  version: string;
  enabled: boolean;
  mobile: boolean;
  channel?: "stable" | "preview";
}
interface Update {
  version?: string;
  notes?: string;
  enabled?: boolean;
  current?: boolean;
  skipped?: boolean;
  ready?: boolean;
  cached?: boolean;
}
type Phase = "idle" | "checking" | "downloading" | "ready" | "installing";
type RouteStatus = {
  source: "proxy" | "github" | "custom";
  fallback: boolean;
  state: "connecting" | "success" | "failed";
};

function useUpdateController(dirty: RefObject<boolean>) {
  const [info, setInfo] = useState<NativeInfo>();
  const [update, setUpdate] = useState<Update>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [changingChannel, setChangingChannel] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState<
    Partial<Record<"check" | "download", RouteStatus>>
  >({});
  const [progress, setProgress] = useState<{
    downloaded: number;
    total?: number;
    fallback?: boolean;
  }>();
  const initialized = useRef(false);
  const confirm = useConfirm();
  const native = nativeBrowser();
  const busy =
    changingChannel ||
    ["checking", "downloading", "installing"].includes(phase);

  async function changeChannel(channel: "stable" | "preview") {
    if (busy || !native || channel === (info?.channel ?? "stable")) return;
    setChangingChannel(true);
    try {
      if (
        (channel === "preview" || phase === "ready") &&
        !(await confirm({
          title:
            channel === "preview" ? "切换到测试版渠道？" : "切换到稳定版渠道？",
          description: `${channel === "preview" ? "测试版用于提前体验新功能，日常库存电脑建议保留稳定版。" : "不会降级当前应用，将等待更高版本的稳定版。"}${phase === "ready" ? "切换后会清除已下载的更新包，并重新检查。" : ""}`,
          confirmLabel: "确认切换",
        }))
      )
        return;
      setError("");
      await native.invoke("set_update_channel", { channel });
      setInfo((previous) => (previous ? { ...previous, channel } : previous));
      setUpdate(undefined);
      setProgress(undefined);
      setRoutes({});
      setPhase("idle");
      await check(false);
    } catch (e) {
      setError(`切换渠道失败：${String(e)}`);
    } finally {
      setChangingChannel(false);
    }
  }

  async function check(automatic: boolean) {
    if (!native) return;
    setPhase("checking");
    setError("");
    let nextPhase: Phase = "idle";
    try {
      const next = (await native.invoke("check_update", {
        automatic,
      })) as Update;
      if (next?.skipped) return;
      setUpdate(next);
      if (next?.ready) nextPhase = "ready";
      if (!automatic || (next?.version && !next.cached && !dirty.current))
        setOpen(true);
    } catch (e) {
      if (!automatic) setError(String(e));
    } finally {
      setPhase(nextPhase);
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
    if (!info?.enabled || info.mobile || phase !== "idle" || changingChannel)
      return;
    const timer = setInterval(() => void check(true), 60 * 60_000);
    return () => clearInterval(timer);
  }, [info?.enabled, info?.mobile, phase, changingChannel]);
  useEffect(() => {
    const listener = (event: Event) =>
      setProgress((event as CustomEvent).detail);
    window.addEventListener("erp:update-progress", listener);
    const routeListener = (event: Event) => {
      const { operation, status } = (
        event as CustomEvent<{
          operation: "check" | "download";
          status: RouteStatus;
        }>
      ).detail;
      setRoutes((previous) => ({ ...previous, [operation]: status }));
    };
    window.addEventListener("erp:update-route", routeListener);
    return () => {
      window.removeEventListener("erp:update-progress", listener);
      window.removeEventListener("erp:update-route", routeListener);
    };
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
  return {
    info,
    update,
    phase,
    open,
    setOpen,
    error,
    progress,
    routes,
    busy,
    check,
    download,
    install,
    connection,
    changeChannel,
    changingChannel,
  };
}

const UpdateContext = createContext<ReturnType<
  typeof useUpdateController
> | null>(null);

export function UpdateProvider({
  dirty,
  children,
}: {
  dirty: RefObject<boolean>;
  children: ReactNode;
}) {
  const updates = useUpdateController(dirty);
  return (
    <UpdateContext.Provider value={updates}>{children}</UpdateContext.Provider>
  );
}

export function useAppUpdates() {
  const updates = useContext(UpdateContext);
  if (!updates) throw new Error("UpdateProvider is required");
  return updates;
}

export function UpdateRoutes() {
  const { routes } = useAppUpdates();
  const sources = {
    proxy: "gh-proxy.com 代理",
    github: "GitHub 直连",
    custom: "配置的更新地址",
  };
  const states = { connecting: "正在连接", success: "已完成", failed: "失败" };
  return (
    <section className="update-routes" aria-label="更新网络线路">
      <p className="muted">线路策略：优先代理，失败后自动尝试 GitHub 直连。</p>
      <dl aria-live="polite">
        {(["check", "download"] as const).map((operation) => {
          const route = routes[operation];
          return (
            <div key={operation}>
              <dt>{operation === "check" ? "检查版本" : "下载安装包"}</dt>
              <dd>
                {route ? (
                  <>
                    {sources[route.source]} · {states[route.state]}
                    {route.fallback && "（已自动切换线路）"}
                  </>
                ) : operation === "check" ? (
                  "本次打开尚未检查"
                ) : (
                  "本次打开尚未下载"
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export function UpdateChannel() {
  const { info, busy, changingChannel, changeChannel } = useAppUpdates();
  if (!info?.enabled || info.mobile || !info.channel) return null;
  return (
    <section className="update-routes" aria-label="更新渠道设置">
      <label htmlFor="update-channel">更新渠道</label>
      <Select
        id="update-channel"
        aria-describedby="update-channel-help"
        value={info.channel ?? "stable"}
        disabled={busy}
        onChange={(event) =>
          void changeChannel(event.target.value as "stable" | "preview")
        }
      >
        <option value="stable">稳定版（推荐）</option>
        <option value="preview">测试版（Beta / RC）</option>
      </Select>
      <p
        id="update-channel-help"
        className="muted"
        style={{ marginTop: 12, marginBottom: 0 }}
      >
        {info.channel === "preview"
          ? "接收已公开的测试版和正式版；草稿不会推送。"
          : "只接收正式版本，适合日常库存使用。"}
        仅影响这台设备。切回稳定版不会降级，等待更高版本的稳定版。
      </p>
      {changingChannel && <p role="status">正在切换渠道并检查更新…</p>}
    </section>
  );
}

export function NativeTools({ pageOpen = false }: { pageOpen?: boolean }) {
  const {
    info,
    update,
    phase,
    open,
    setOpen,
    error,
    progress,
    busy,
    check,
    download,
    install,
    connection,
  } = useAppUpdates();
  useEffect(() => {
    if (pageOpen && open) setOpen(false);
  }, [pageOpen, open, setOpen]);
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
        {info.mobile ? (
          <Settings2 aria-hidden="true" size={19} />
        ) : (
          <Download aria-hidden="true" size={19} />
        )}
      </Button>
      {open && !pageOpen && (
        <Modal
          title={info.mobile ? "连接设置" : "应用更新"}
          onClose={() => {
            if (phase !== "installing") setOpen(false);
          }}
        >
          <p>当前版本：{info.version}</p>
          {!pageOpen && <UpdateChannel />}
          {info.enabled && !info.mobile && <UpdateRoutes />}
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
          {update?.current && (
            <p role="status">当前渠道暂无更高版本，无需更新。</p>
          )}
          {phase === "checking" && <p role="status">正在检查新版本…</p>}
          {phase === "downloading" && (
            <div role="status">
              <p>正在下载并验证更新，不影响当前库存操作。</p>
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
          <p className="muted">稍后可从「版本更新」页面继续下载或安装。</p>
          <div className="form-actions form-footer">
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
