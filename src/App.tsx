import { Form, Input, Button, Checkbox } from "./ui";
import { NativeTools, UpdateProvider } from "./NativeTools";
import { ServiceUpdate } from "./ServiceUpdate";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useNavigation, useVisualViewport, type Page } from "./navigation";
import { browserLogin, openDesktopBrowser } from "./browserLogin";
import {
  Boxes,
  LayoutDashboard,
  PackageSearch,
  ClipboardList,
  ReceiptText,
  Wallet,
  ContactRound,
  ListChecks,
  ClipboardCheck,
  UsersRound,
  Settings,
  LogOut,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ShieldCheck,
  Eye,
  EyeOff,
  MoreHorizontal,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import {
  api,
  send,
  type User,
  type Document,
  quantity,
  dateTime,
  movementLabels,
} from "./api";
import {
  Field,
  Modal,
  Loading,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "./components";

const Sales = lazy(() => import("./pages/Sales"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Movement = lazy(() => import("./pages/Movement"));
const Records = lazy(() => import("./pages/Records"));
const Stocktakes = lazy(() => import("./pages/Stocktakes"));
const Users = lazy(() => import("./pages/Users"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const UpdatesPage = lazy(() => import("./pages/Updates"));
import WebAccess from "./WebAccess";

function Login({
  initialized,
  onLogin,
  onSetup,
}: {
  initialized: boolean;
  onLogin: (u: User) => void;
  onSetup: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const action = useAction();
  return (
    <div className="login-page">
      <section className="login-intro">
        <div className="brand">
          <Boxes size={30} />
          <span>库存管理</span>
        </div>
        <h1>
          东西进出，
          <br />
          心里有数。
        </h1>
        <p>
          原材料和成品，一本清楚的库存账。
          <br />
          每个人的操作，都有据可查。
        </p>
        <div className="login-points">
          <span>
            <ShieldCheck size={20} /> 独立账号 · 操作有记录
          </span>
          <span>
            <Boxes size={20} /> 同一网络内共用 · 数据保存在自己的电脑
          </span>
        </div>
      </section>
      <section className="login-card">
        <h2>{initialized ? "登录库存管理" : "设置第一位管理员"}</h2>
        <p className="muted">
          {initialized
            ? "使用管理员分配的账号。共用电脑请不要记住登录。"
            : "首次设置在保存库存的电脑上完成，之后其他人员即可登录。"}
        </p>
        <Form
          onSubmit={(e) =>
            form(e, () =>
              action.run(async () => {
                if (!initialized) {
                  await send("/setup", { username, name, password });
                  onSetup();
                }
                const result = await send<{ user: User }>("/login", {
                  username,
                  password,
                  remember,
                });
                onLogin(result.user);
              }),
            )
          }
        >
          {!initialized && (
            <>
              <Field label="管理员姓名" required>
                {(p) => (
                  <Input
                    {...p}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                  />
                )}
              </Field>
            </>
          )}
          <Field
            label="登录账号"
            required
            hint={
              !initialized ? "3–32 位字母、数字、下划线或短横线。" : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                maxLength={32}
                autoCapitalize="none"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            label="登录密码"
            required
            hint={
              !initialized
                ? "至少 8 个字符，可以用一句容易记住的话。"
                : undefined
            }
          >
            {(p) => (
              <div className="password">
                <Input
                  {...p}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  type={show ? "text" : "password"}
                  autoComplete={
                    initialized ? "current-password" : "new-password"
                  }
                  minLength={!initialized ? 8 : undefined}
                  maxLength={128}
                />
                <Button
                  type="button"
                  className="icon-button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "隐藏密码" : "显示密码"}
                >
                  {show ? <EyeOff size={19} /> : <Eye size={19} />}
                </Button>
              </div>
            )}
          </Field>
          <label className="checkbox">
            <Checkbox
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            这是我的专用设备，记住登录（30 天未使用才过期）
          </label>
          {action.error && <Notice>{action.error}</Notice>}
          <Submit busy={action.busy}>
            {initialized ? "登录" : "设置并登录"}
          </Submit>
        </Form>
      </section>
    </div>
  );
}

function Home({
  user,
  revision,
  navigate,
}: {
  user: User;
  revision: number;
  navigate: (page: Page) => void;
}) {
  const { data, error } = useResource<{ items: Document[] }>(
    "/documents",
    revision,
  );
  const stock = useResource<{ total: number }>("/items", revision);
  const [webAccess, setWebAccess] = useState(false);
  const low = useResource<{ total: number }>("/items?low=true", revision);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{user.name}的工作台</h1>
          <p>库存概况与常用操作</p>
        </div>
        <div className="row-actions">
          <Button className="button" onClick={() => setWebAccess(true)}>
            <ExternalLink size={17} />在 Web 中打开
          </Button>
          <span className="date-label">
            {new Intl.DateTimeFormat("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
          </span>
        </div>
      </div>
      {webAccess && <WebAccess onClose={() => setWebAccess(false)} />}
      <div className="stock-summary">
        <Button className="summary-card" onClick={() => navigate("inventory")}>
          <span>物料总数</span>
          <strong>
            {stock.data?.total ?? "—"}
            <small>种</small>
          </strong>
          <ChevronRight size={18} />
        </Button>
        <Button className="summary-card" onClick={() => navigate("inventory")}>
          <span>库存不足</span>
          <strong className={low.data?.total ? "warning-number" : ""}>
            {low.data?.total ?? "—"}
            <small>种</small>
          </strong>
          <ChevronRight size={18} />
        </Button>
      </div>
      {(user.role === "admin" || (user.role === "worker" && user.can_out)) && (
        <Button className="button primary" onClick={() => navigate("sales")}>
          开单发货
        </Button>
      )}
      <div className="task-grid">
        {(user.role === "admin" || user.can_in) && (
          <Button className="task-card inbound" onClick={() => navigate("in")}>
            <span className="task-icon">
              <ArrowDownToLine size={28} />
            </span>
            <strong>我要入库</strong>
            <span>收货、完工、退回</span>
          </Button>
        )}
        {(user.role === "admin" || user.can_out) && (
          <Button
            className="task-card outbound"
            onClick={() => navigate("out")}
          >
            <span className="task-icon">
              <ArrowUpFromLine size={28} />
            </span>
            <strong>我要出库</strong>
            <span>领料、发货</span>
          </Button>
        )}
        <Button
          className="task-card lookup"
          onClick={() => navigate("inventory")}
        >
          <span className="task-icon">
            <PackageSearch size={28} />
          </span>
          <strong>查库存</strong>
          <span>找物料、看数量</span>
        </Button>
      </div>
      <div className="activity-feed">
        <section className="panel">
          <div className="section-title">
            <h2>{user.role === "admin" ? "最近的出入库" : "我最近的出入库"}</h2>
            <Button className="text-button" onClick={() => navigate("records")}>
              查看全部 →
            </Button>
          </div>
          {error && <Notice>{error}</Notice>}
          {data?.items.length ? (
            data.items.slice(0, 6).map((doc) => (
              <div className="recent-row" key={doc.id}>
                <span className="badge">
                  {movementLabels[doc.kind] ?? doc.kind}
                </span>
                <div>
                  <strong>{doc.lines[0]?.name ?? "库存调整"}</strong>
                  <small>
                    {doc.actor_name} · {dateTime(doc.created_at)}
                  </small>
                </div>
                <span>
                  {doc.lines.length === 1
                    ? `${quantity(doc.lines[0].quantity, doc.lines[0].precision)} ${doc.lines[0].unit}`
                    : `${doc.lines.length} 种物料`}
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              还没有记录，完成第一笔入库后会显示在这里。
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function App() {
  const dirty = useRef(false);
  return (
    <UpdateProvider dirty={dirty}>
      <Application dirty={dirty} />
    </UpdateProvider>
  );
}

function Application({ dirty }: { dirty: RefObject<boolean> }) {
  const [user, setUser] = useState<User>();
  const [initialized, setInitialized] = useState(true);
  const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const {
    route: { page, initialItem },
    navigate,
    back,
    reset,
  } = useNavigation(dirty);
  useVisualViewport();
  const [moreOpen, setMoreOpen] = useState(false);
  const logout = useAction();
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    if (!user) return;
    let lastCheck = Date.now();
    const keepSession = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastCheck < 5 * 60_000
      )
        return;
      lastCheck = Date.now();
      // Only real interaction renews a form-only session; idle tabs stay idle.
      void api<User>("/me").catch(() => {});
    };
    window.addEventListener("pointerdown", keepSession, { passive: true });
    window.addEventListener("keydown", keepSession);
    return () => {
      window.removeEventListener("pointerdown", keepSession);
      window.removeEventListener("keydown", keepSession);
    };
  }, [user?.id]);
  useEffect(() => {
    const open = () => {
      void openDesktopBrowser(location.origin, !!user).catch((error: Error) => {
        setBrowserError(error.message);
      });
    };
    window.addEventListener("erp:open-browser", open);
    return () => window.removeEventListener("erp:open-browser", open);
  }, [user]);
  useEffect(() => {
    api<{ initialized: boolean }>("/status")
      .then(async (s) => {
        setInitialized(s.initialized);
        if (browserLogin) {
          const result = await browserLogin;
          if (result.error) throw new Error(result.error);
          setUser(result.user);
          return;
        }
        if (s.initialized)
          return api<User>("/me")
            .then(setUser)
            .catch(() => {});
      })
      .catch((e) => setStartError(e.message))
      .finally(() => setStarting(false));
  }, []);
  useEffect(() => {
    const expired = () => setUser(undefined);
    const focus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("erp:unauthorized", expired);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("erp:unauthorized", expired);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, []);
  if (starting) return <Loading />;
  if (startError)
    return (
      <main className="recovery">
        <NativeTools />
        <Notice>{startError}</Notice>
        <Button className="button" onClick={() => location.reload()}>
          重新连接库存电脑
        </Button>
      </main>
    );
  if (!user)
    return (
      <>
        <div className="native-login-tools">
          <NativeTools />
        </div>
        <Login
          initialized={initialized}
          onSetup={() => setInitialized(true)}
          onLogin={(u) => {
            setUser(u);
            reset();
            refresh();
          }}
        />
      </>
    );
  const nav = [
    { id: "home", label: "工作台", icon: LayoutDashboard },
    { id: "inventory", label: "库存", icon: PackageSearch },
    ...(user.role === "admin" || (user.role === "worker" && user.can_out)
      ? [{ id: "sales", label: "开单与收款", icon: ReceiptText }]
      : []),
    ...(user.role === "admin" || (user.role === "worker" && user.can_out)
      ? [{ id: "customers", label: "客户", icon: ContactRound }]
      : []),
    ...(user.role === "admin"
      ? [{ id: "finance", label: "财务", icon: Wallet }]
      : []),
    { id: "records", label: "记录", icon: ClipboardList },
    ...(user.role === "admin" || user.can_count
      ? [{ id: "stocktakes", label: "清点库存", icon: ClipboardCheck }]
      : []),
    ...(user.role === "admin"
      ? [
          { id: "catalog", label: "基础资料", icon: ListChecks },
          { id: "users", label: "人员与权限", icon: UsersRound },
          { id: "settings", label: "数据与备份", icon: Settings },
        ]
      : []),
    { id: "updates", label: "版本更新", icon: RefreshCw },
  ];
  return (
    <div className="app-shell" data-flow={page === "in" || page === "out"}>
      {browserError && (
        <Modal title="无法打开浏览器" onClose={() => setBrowserError("")}>
          <Notice>{browserError}</Notice>
        </Modal>
      )}
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <Boxes size={27} />
          <span>库存管理</span>
        </div>
        <nav aria-label="主要导航">
          {[
            {
              label: "常用功能",
              ids: [
                "home",
                "inventory",
                "sales",
                "finance",
                "customers",
                "records",
                "stocktakes",
              ],
            },
            {
              label: "管理与设置",
              ids: ["catalog", "users", "settings", "updates"],
            },
          ].map((group) => (
            <div
              className="nav-group"
              role="group"
              aria-label={group.label}
              key={group.label}
            >
              <p className="nav-group-title" aria-hidden="true">
                {group.label}
              </p>
              {nav
                .filter(({ id }) => group.ids.includes(id))
                .map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    className={`${page === id ? "nav-item active" : "nav-item"} ${["sales", "finance", "customers", "catalog", "users", "settings", "updates"].includes(id) ? "secondary-nav" : ""}`}
                    onClick={() => navigate(id as Page)}
                    aria-current={page === id ? "page" : undefined}
                  >
                    <Icon size={21} />
                    <span>{label}</span>
                  </Button>
                ))}
            </div>
          ))}
          <Button
            className={`nav-item mobile-more ${moreOpen || ["sales", "finance", "customers", "catalog", "users", "settings", "updates"].includes(page) ? "active" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal size={21} />
            <span>更多</span>
          </Button>
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <span>
            数据保存在库存电脑
            <br />
            <small>自动保存操作记录</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="mobile-brand">
            <Boxes size={22} />
            库存管理
          </span>
          <span className="connection">
            <strong className="workspace-title">
              {nav.find((item) => item.id === page)?.label ??
                (page === "in" ? "入库登记" : "出库登记")}
            </strong>
            <i />
            已连接库存电脑
          </span>
          <div className="topbar-actions">
            <NativeTools pageOpen={page === "updates"} />
            <Button
              className="icon-button"
              onClick={refresh}
              aria-label="刷新数据"
            >
              <RefreshCw size={19} />
            </Button>
            <span className="user-avatar">{user.name.slice(0, 1)}</span>
            <span className="account-name">
              {user.name}
              <small>
                {user.role === "admin"
                  ? "管理员"
                  : user.role === "viewer"
                    ? "查看员"
                    : "操作员"}
              </small>
            </span>
            <Button
              className="button small desktop-logout"
              onClick={() =>
                logout.run(async () => {
                  await send("/logout", {});
                  setUser(undefined);
                })
              }
            >
              <LogOut size={16} />
              退出登录
            </Button>
          </div>
        </header>
        <ServiceUpdate dirty={dirty} />
        <main id="main" tabIndex={-1}>
          {logout.error && <Notice>{logout.error}</Notice>}
          <Suspense fallback={<Loading />}>
            {page === "updates" && <UpdatesPage />}
            {page === "home" && (
              <Home user={user} revision={revision} navigate={navigate} />
            )}
            {page === "inventory" && (
              <Inventory
                user={user}
                revision={revision}
                refresh={refresh}
                openSale={(item) => {
                  void navigate("sales", item);
                }}
                move={(direction, item) => {
                  navigate(direction, item);
                }}
              />
            )}
            {(page === "in" || page === "out") && (
              <Movement
                key={`${page}-${initialItem?.id ?? ""}`}
                user={user}
                direction={page}
                initial={initialItem}
                done={refresh}
                back={back}
                home={() => navigate("home")}
                onDirtyChange={(value) => {
                  dirty.current = value;
                }}
              />
            )}
            {["sales", "finance", "customers", "catalog"].includes(page) &&
              (user.role === "admin" ||
                (["sales", "customers"].includes(page) &&
                  user.role === "worker" &&
                  user.can_out)) && (
                <Sales
                  key={`${page}-${initialItem?.id || ""}`}
                  initialItem={page === "sales" ? initialItem : undefined}
                  view={page as "sales" | "finance" | "customers" | "catalog"}
                  user={user}
                  revision={revision}
                  refresh={refresh}
                  onDirtyChange={(value) => {
                    dirty.current = value;
                  }}
                />
              )}
            {page === "catalog" && user.role !== "admin" && (
              <Notice>基础资料管理仅管理员可操作。</Notice>
            )}
            {page === "finance" && user.role !== "admin" && (
              <Notice>财务汇总仅管理员可查看。</Notice>
            )}
            {page === "records" && (
              <Records user={user} revision={revision} refresh={refresh} />
            )}
            {page === "stocktakes" && (
              <Stocktakes user={user} revision={revision} refresh={refresh} />
            )}
            {page === "users" && user.role === "admin" && (
              <Users revision={revision} refresh={refresh} />
            )}
            {page === "settings" && user.role === "admin" && (
              <SettingsPage revision={revision} refresh={refresh} />
            )}
          </Suspense>
        </main>
      </div>
      {moreOpen && (
        <Modal title="更多与账户" onClose={() => setMoreOpen(false)}>
          <div className="mobile-account">
            <span className="user-avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin"
                  ? "管理员"
                  : user.role === "viewer"
                    ? "查看员"
                    : "操作员"}
              </small>
            </div>
          </div>
          <nav className="more-menu" aria-label="更多功能">
            {nav
              .filter((item) =>
                [
                  "sales",
                  "finance",
                  "customers",
                  "catalog",
                  "users",
                  "settings",
                  "updates",
                ].includes(item.id),
              )
              .map(({ id, label, icon: Icon }) => (
                <Button
                  className="more-menu-item"
                  key={id}
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(id as Page);
                  }}
                >
                  <Icon size={22} />
                  <span>{label}</span>
                  <ChevronRight size={18} />
                </Button>
              ))}
          </nav>
          {logout.error && <Notice>{logout.error}</Notice>}
          <Button
            className="button mobile-signout"
            disabled={logout.busy}
            onClick={() =>
              logout.run(async () => {
                await send("/logout", {});
                setMoreOpen(false);
                setUser(undefined);
                reset();
              })
            }
          >
            <LogOut size={18} />
            {logout.busy ? "正在退出…" : "退出登录"}
          </Button>
        </Modal>
      )}
    </div>
  );
}
