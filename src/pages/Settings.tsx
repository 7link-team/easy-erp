import TableImport from "../TableImport";
import { Disclosure } from "../ui";
import { Form, Input, Button } from "../ui";
import { useEffect, useState } from "react";
import { api, send, dateTime } from "../api";
import {
  Field,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

interface Schedule {
  keep_days: number;
}
interface Backup {
  name: string;
  created_at: number;
  size: number;
}

export default function Settings({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const action = useAction();
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState<Backup>();
  const [confirmation, setConfirmation] = useState("");
  const [schedule, setSchedule] = useState<Schedule>({
    keep_days: 7,
  });
  const { data, error } = useResource<{
    items: Backup[];
    schedule: Schedule;
    last_success: string;
    last_error: string;
  }>("/backups", revision);
  useEffect(() => {
    if (data) setSchedule(data.schedule);
  }, [data]);
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
          包含库存、历史记录、账号与权限。请在保存库存的电脑上操作；建议把 ZIP
          备份下载到 U 盘或另一台电脑，避免电脑损坏时数据和备份一起丢失。
        </p>
        <Button
          className="button primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await send("/backups", {});
              setMessage("完整备份已生成。");
              refresh();
            })
          }
        >
          {action.busy ? "正在处理…" : "立即备份全部数据"}
        </Button>
        {error && <Notice>{error}</Notice>}
        <div className="backup-list">
          {data?.items.map((b) => (
            <div className="document" key={b.name}>
              <span>
                {dateTime(b.created_at)}
                <small>{Math.ceil(b.size / 1024)} KB</small>
              </span>
              <div className="row-actions">
                <a
                  className="button small"
                  href={`/api/backups/${encodeURIComponent(b.name)}`}
                >
                  下载完整备份
                </a>
                <Button
                  className="button small"
                  aria-label={`恢复备份 ${b.name}`}
                  onClick={() => {
                    setRestoring(b);
                    setConfirmation("");
                    action.setError("");
                  }}
                >
                  恢复这个备份
                </Button>
              </div>
            </div>
          ))}
        </div>
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
        <Modal title="恢复全部数据" onClose={() => setRestoring(undefined)}>
          <Notice>
            将恢复到 {dateTime(restoring.created_at)}{" "}
            的备份。之后新增的数据不会保留，所有账号需要重新登录。系统会先备份当前数据。
          </Notice>
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
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
                onClick={() => setRestoring(undefined)}
              >
                取消
              </Button>
              <Submit busy={action.busy}>恢复全部数据并退出登录</Submit>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
