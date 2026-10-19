import TableImport from "../TableImport";
import { Disclosure, useConfirm } from "../ui";
import { Form, Input, Button } from "../ui";
import { useEffect, useRef, useState } from "react";
import { api, send, dateTime } from "../api";
import { nativeBrowser } from "../browserLogin";
import { useAppUpdates } from "../NativeTools";
import {
  Field,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
  TableScroll,
  Loading,
  Empty,
} from "../components";

interface Schedule {
  keep_days: number;
}
interface Backup {
  name: string;
  created_at: number;
  size: number;
  snapshot_at: number | null;
  source: string | null;
  photo_count: number | null;
  path: string;
  metadata_error: boolean;
}
const backupSources = new Map([
  ["manual", "手动"],
  ["automatic", "每小时自动"],
  ["restore", "恢复前保护"],
  ["upgrade", "升级前保护"],
  ["maintenance", "维护前保护"],
  ["shutdown", "退出或升级前"],
]);
const backupPageSize = 10;

interface SystemInfo {
  version: string;
  instance_id: string;
  bind: string;
  database_connected: boolean;
  database: { kind: string; source: string; location: string; tls?: boolean };
  data_dir: string;
  storage: string;
  local_storage: string;
  backup_location: string;
  attachment_location: string;
  backup_policy: string;
  secure_cookie: boolean;
  trusted_proxy: boolean;
  server_mode: boolean;
  updating: boolean;
  storage_source: string;
}

export default function Settings({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const action = useAction();
  const confirmDanger = useConfirm();
  const system = useResource<SystemInfo>("/system-info", revision);
  const { info: nativeInfo } = useAppUpdates();
  const [locations, setLocations] = useState<{
    local: boolean;
    items: {
      label: string;
      path: string;
      exists?: boolean;
      size?: number;
      modified?: number;
    }[];
    details?: { label: string; value: string }[];
  }>();
  const [locationsError, setLocationsError] = useState("");
  useEffect(() => {
    if (!nativeInfo || nativeInfo.mobile) return;
    let cancelled = false;
    nativeBrowser()
      ?.invoke("file_locations", {})
      .then((result) => {
        if (!cancelled) setLocations(result as typeof locations);
      })
      .catch((error) => {
        if (!cancelled) setLocationsError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [nativeInfo]);
  function filePath(path: string) {
    return (
      <div className="file-location">
        <code className="file-location-path">{path}</code>
        {locations?.local && !path.startsWith("s3://") ? (
          <Button
            className="button small"
            disabled={action.busy}
            aria-label={`在文件管理器中查看 ${path}`}
            onClick={() =>
              action.run(async () => {
                await nativeBrowser()!.invoke("reveal_file", { path });
              })
            }
          >
            打开位置
          </Button>
        ) : (
          <small className="muted">
            {path.startsWith("s3://")
              ? "对象存储路径"
              : "请在库存主机的桌面版中查看"}
          </small>
        )}
      </div>
    );
  }
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState<Backup>();
  const [confirmation, setConfirmation] = useState("");
  const [backupPage, setBackupPage] = useState(1);
  const [schedule, setSchedule] = useState<Schedule>({
    keep_days: 7,
  });
  const { data, error, loading } = useResource<{
    items: Backup[];
    schedule: Schedule;
    last_success: string;
    last_error: string;
  }>("/backups", revision);
  // A background refetch (window focus) must not overwrite an edit in progress,
  // so the loaded value is adopted once per load cycle rather than on every
  // response.
  const scheduleLoaded = useRef(false);
  useEffect(() => {
    if (data && !scheduleLoaded.current) {
      scheduleLoaded.current = true;
      setSchedule(data.schedule);
    }
  }, [data]);
  const backupCount = data?.items.length ?? 0;
  const backupPages = Math.max(1, Math.ceil(backupCount / backupPageSize));
  const currentBackupPage = Math.min(backupPage, backupPages);
  const visibleBackups = data?.items.slice(
    (currentBackupPage - 1) * backupPageSize,
    currentBackupPage * backupPageSize,
  );
  useEffect(() => {
    setBackupPage((page) => Math.min(page, backupPages));
  }, [backupPages]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>备份</h1>
          <p>表格用于查看与交接；完整备份用于恢复整个库存账。</p>
          <Disclosure className="more" title="备份和导出有什么区别？">
            <p>
              完整备份是 .zip
              压缩包，保存整个库存账，包括账号、权限和操作记录。请用本应用恢复，恢复前会自动检查文件是否损坏。
            </p>
            <p>Excel/CSV 表格用于查看、交接和导入物料，不能代替完整备份。</p>
          </Disclosure>
        </div>
      </div>
      {action.error && <Notice>{action.error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      <section className="panel">
        <h2>自动备份</h2>
        <p>
          每小时自动备份一次。库存服务在后台运行时，关闭窗口也会继续备份；电脑休眠或关机时暂停，恢复运行后补做已到期的备份。
        </p>
        <Form
          onSubmit={(e) =>
            form(e, () =>
              action.run(async () => {
                await send("/backups/schedule", schedule, "PUT");
                scheduleLoaded.current = false;
                setMessage("备份保留天数已保存。");
                refresh();
              }),
            )
          }
        >
          <div className="form-grid">
            <Field
              label="保留天数"
              required
              hint="填写 1–365 的整数，默认 7 天。保留这些天内的全部备份；超期文件在下一次备份成功后清理，备份失败不会删除旧文件。"
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  required
                  value={schedule.keep_days || ""}
                  onChange={(e) =>
                    setSchedule((s) => ({
                      ...s,
                      keep_days: Number(e.target.value),
                    }))
                  }
                />
              )}
            </Field>
          </div>
          <div className="form-actions form-footer">
            <Submit busy={action.busy}>保存设置</Submit>
          </div>
        </Form>
        {data?.last_success && (
          <p className="hint">
            最近成功：{dateTime(Number(data.last_success))}
          </p>
        )}
        {data?.last_error && (
          <Notice>最近一次自动备份失败：{data.last_error}</Notice>
        )}
      </section>
      <section className="panel section-divider">
        <h2>完整备份与恢复</h2>
        <p>
          包含库存、历史记录、账号、权限与凭证图片。请在保存库存的电脑上操作；建议把
          ZIP 备份下载到 U 盘或另一台电脑，避免电脑损坏时数据和备份一起丢失。
        </p>
        <Button
          className="button primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await send("/backups", {});
              setBackupPage(1);
              setMessage("完整备份已生成。");
              refresh();
            })
          }
        >
          {action.busy ? "正在处理…" : "立即备份全部数据"}
        </Button>
        {error && <Notice>{error}</Notice>}
        <p className="hint">
          图片数量包含备份内保留的历史凭证。旧备份未记录的信息显示未知；列表信息不代替恢复时的完整校验。
        </p>
        {loading ? (
          <Loading />
        ) : !error && !data?.items.length ? (
          <Empty>暂无完整备份，可点击“立即备份全部数据”生成。</Empty>
        ) : (
          !error && (
            <TableScroll>
              <table className="backup-table" aria-label="备份记录">
                <thead>
                  <tr>
                    <th>时间 / 文件</th>
                    <th>方式</th>
                    <th className="numeric">大小</th>
                    <th className="numeric">凭证图片</th>
                    <th>存放位置（库存主机）</th>
                    <th className="ledger-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBackups?.map((b) => (
                    <tr key={b.name}>
                      <td data-label="时间 / 文件">
                        <strong>
                          {dateTime(b.snapshot_at ?? b.created_at)}
                        </strong>
                        <small>{b.name}</small>
                        {b.snapshot_at === null && (
                          <small>文件修改时间；生成时间未知</small>
                        )}
                        {b.metadata_error && (
                          <small className="field-error">
                            无法读取备份信息，恢复时将检查文件。
                          </small>
                        )}
                      </td>
                      <td data-label="方式">
                        {backupSources.get(b.source || "") || "未知"}
                      </td>
                      <td className="numeric" data-label="大小">
                        {Math.ceil(b.size / 1024).toLocaleString()} KB
                      </td>
                      <td className="numeric" data-label="凭证图片">
                        {b.photo_count === null
                          ? "未知"
                          : `${b.photo_count.toLocaleString()} 张`}
                      </td>
                      <td
                        className="backup-path"
                        data-label="存放位置（库存主机）"
                      >
                        {filePath(b.path)}
                      </td>
                      <td className="ledger-actions">
                        <div className="row-actions">
                          <a
                            className="button small"
                            aria-label={`下载完整备份 ${b.name}`}
                            href={`/api/backups/${encodeURIComponent(b.name)}`}
                            download
                          >
                            下载完整备份
                          </a>
                          <Button
                            className="button small"
                            aria-label={`恢复备份 ${b.name}`}
                            disabled={action.busy}
                            onClick={() => {
                              setRestoring(b);
                              setConfirmation("");
                              action.setError("");
                            }}
                          >
                            恢复这个备份
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )
        )}
        {!loading && !error && backupCount > 0 && (
          <nav className="pagination" aria-label="备份记录分页">
            <span aria-live="polite">
              共 {backupCount} 份备份 · 每页 {backupPageSize} 条 · 第{" "}
              {currentBackupPage} / {backupPages} 页
            </span>
            <div>
              <Button
                className="button small"
                disabled={currentBackupPage === 1}
                onClick={() => setBackupPage(currentBackupPage - 1)}
              >
                上一页
              </Button>
              <Button
                className="button small"
                disabled={currentBackupPage === backupPages}
                onClick={() => setBackupPage(currentBackupPage + 1)}
              >
                下一页
              </Button>
            </div>
          </nav>
        )}
      </section>
      <section className="panel section-divider" aria-label="系统信息">
        <h2>系统信息 · 当前库存主机</h2>
        <p className="hint">
          以下为当前连接主机的实际运行信息；连接远程库存时，这些位置属于远程主机。密码、密钥和完整连接串不会显示。
        </p>
        {system.error && <Notice>{system.error}</Notice>}
        {system.loading && <Loading />}
        {system.data && (
          <>
            <dl className="system-information">
              {Object.entries({
                访问地址: location.origin,
                连接方式: nativeInfo?.mobile
                  ? "移动端连接"
                  : locations
                    ? locations.local
                      ? "桌面本机模式"
                      : "桌面远程模式"
                    : "浏览器访问",
                服务版本: system.data.version,
                实例标识: system.data.instance_id,
                监听地址: system.data.bind,
                数据库: `${system.data.database.kind} · ${system.data.database_connected ? "连接正常" : "连接异常"}`,
                数据库位置: system.data.database.location,
                数据库配置来源: system.data.database.source,
                文件存储:
                  system.data.storage === "s3" ? "S3 对象存储" : "本地文件",
                本地存储目录来源: system.data.storage_source,
                服务状态: system.data.updating
                  ? "正在维护或更新"
                  : "运行中（本次读取成功）",
                部署方式: system.data.server_mode ? "独立服务器" : "桌面服务",
                "安全 Cookie": system.data.secure_cookie ? "开启" : "关闭",
                信任反向代理: system.data.trusted_proxy ? "开启" : "关闭",
                备份总量: `${backupCount} 份 · ${((data?.items.reduce((sum, item) => sum + item.size, 0) ?? 0) / 1024 / 1024).toFixed(2)} MB`,
                自动备份保留: `${data?.schedule.keep_days ?? "—"} 天`,
                更新渠道:
                  nativeInfo?.channel === "preview"
                    ? "测试版"
                    : nativeInfo?.channel === "stable"
                      ? "稳定版"
                      : "不适用",
              }).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {Object.entries({
              主机数据目录: system.data.data_dir,
              本地文件存储目录: system.data.local_storage,
              备份位置: system.data.backup_location,
              附件位置: system.data.attachment_location,
              备份策略文件: system.data.backup_policy,
            }).map(([label, path]) => (
              <div className="local-file-row" key={label}>
                <strong>{label}</strong>
                {filePath(path)}
              </div>
            ))}
          </>
        )}
      </section>
      <section className="panel section-divider">
        <h2>本机数据维护</h2>
        {locationsError && <Notice>{locationsError}</Notice>}
        {locations?.details?.map((item) => (
          <p key={item.label}>
            <strong>{item.label}：</strong>
            {item.value}
          </p>
        ))}
        {locations?.items.map((item) => (
          <div key={item.path} className="local-file-row">
            <strong>{item.label}</strong>
            {filePath(item.path)}
            {item.exists !== undefined && (
              <small>
                {item.exists ? "已存在" : "尚未创建"}
                {item.size !== null && item.size !== undefined
                  ? ` · ${item.size.toLocaleString()} 字节`
                  : ""}
                {item.modified ? ` · 修改于 ${dateTime(item.modified)}` : ""}
              </small>
            )}
          </div>
        ))}
        <p>
          清空数据（不含备份数据）、从外部备份恢复、清空备份，请在桌面版的“本机数据维护”中操作。
          仅维护这台电脑的本机数据，不会清空当前连接的远程库存电脑。
        </p>
        <p className="hint">
          也可从桌面顶部菜单或托盘菜单选择“本机数据维护”。清空前请核对数据目录；清空操作需要输入确认文字，不可撤销。
        </p>
        {nativeInfo && !nativeInfo.mobile ? (
          <Button
            className="button"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await nativeBrowser()!.invoke("open_data_maintenance", {});
              })
            }
          >
            打开本机数据维护
          </Button>
        ) : (
          <p className="hint">请到需要维护的电脑上打开桌面版。</p>
        )}
      </section>
      <section className="panel section-divider">
        <h2>导入已有表格</h2>
        <TableImport onImported={refresh} />
      </section>
      <section className="panel section-divider">
        <h2>导出表格</h2>
        <p>
          可以用 Excel 打开。表格不包含完整账号和历史关系，不能代替完整备份。
        </p>
        <div className="row-actions">
          <a className="button" href="/api/export/items?format=xlsx">
            导出物料及库存 · Excel
          </a>
          <a className="button" href="/api/export/items?format=csv">
            导出物料及库存 · CSV
          </a>
          <a className="button" href="/api/export/documents?format=xlsx">
            导出出入库记录
          </a>
          <a className="button" href="/api/export/audit?format=xlsx">
            导出操作记录
          </a>
        </div>
      </section>
      {restoring && (
        <Modal
          title="恢复全部数据"
          onClose={() => {
            if (!action.busy) {
              setRestoring(undefined);
              setConfirmation("");
            }
          }}
        >
          <p className="danger-warning">
            危险操作：覆盖当前库存主机 {location.host}{" "}
            的全部业务、账号和设置。备份来源：{restoring.path}
          </p>
          <Notice>
            {restoring.snapshot_at === null
              ? `此备份生成时间未知，文件修改时间为 ${dateTime(restoring.created_at)}。`
              : `将恢复到 ${dateTime(restoring.snapshot_at)} 的备份。`}
            恢复后，备份之后新增的数据不会保留，所有账号需要重新登录。系统会先备份当前数据。
          </Notice>
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  if (confirmation !== "恢复全部数据") {
                    action.setError("请输入“恢复全部数据”确认操作。");
                    return;
                  }
                  if (
                    !(await confirmDanger({
                      title: "再次确认覆盖全部数据？",
                      description: `目标库存主机：${location.host}；备份：${restoring.name}。备份之后新增的数据将被覆盖，所有账号需要重新登录。确认后立即执行，无法撤销。`,
                      confirmLabel: "确认覆盖，立即恢复",
                      danger: true,
                    }))
                  ) {
                    setConfirmation("");
                    return;
                  }
                  await send("/backups/restore", {
                    name: restoring.name,
                    confirmation,
                  });
                  window.dispatchEvent(new Event("erp:unauthorized"));
                }),
              )
            }
          >
            <Field
              label="恢复确认"
              required
              hint="输入“恢复全部数据”，确认用备份替换现在的数据。"
            >
              {(p) => (
                <Input
                  {...p}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  autoComplete="off"
                />
              )}
            </Field>
            {action.error && <Notice>{action.error}</Notice>}
            <div className="form-actions form-footer">
              <Button
                type="button"
                className="button"
                disabled={action.busy}
                onClick={() => {
                  setRestoring(undefined);
                  setConfirmation("");
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                className="button danger"
                disabled={action.busy || confirmation !== "恢复全部数据"}
              >
                恢复全部数据并退出登录
              </Button>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
