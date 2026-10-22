import { useEffect, useRef, useState } from "react";
import { Form, Input, Button, Select, Checkbox } from "../ui";
import { send, dateTime } from "../api";
import {
  Field,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
  TableScroll,
  Loading,
  Empty,
} from "../components";

type ReportPeriod = "day" | "week" | "month" | "quarter" | "year";
type ReportFormat = "xlsx" | "pdf";
interface ReportScheduleData {
  webhook: string;
  webhook_set: boolean;
  format: ReportFormat;
  hour: number;
  minute: number;
  periods: ReportPeriod[];
  last_error?: string;
}
const reportPeriods: { value: ReportPeriod; label: string; name: string }[] = [
  { value: "day", label: "每天", name: "日报" },
  { value: "week", label: "每周最后一天", name: "周报" },
  { value: "month", label: "每月最后一天", name: "月报" },
  { value: "quarter", label: "每季度最后一天", name: "季报" },
  { value: "year", label: "每年最后一天", name: "年报" },
];
const pdfHint = "需要库存主机上装有中文字体，否则会提示失败";

function toTime({ hour, minute }: ReportScheduleData) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function Reports({ revision }: { revision: number }) {
  const resource = useResource<ReportScheduleData>(
    "/report-schedule",
    revision,
  );
  const [draft, setDraft] = useState<ReportScheduleData>();
  const [time, setTime] = useState("");
  const [address, setAddress] = useState("");
  const [clearAddress, setClearAddress] = useState(false);
  const loaded = useRef(false);
  const action = useAction();
  const generate = useAction();
  const [message, setMessage] = useState("");
  const [generated, setGenerated] = useState(false);
  const [reportRevision, setReportRevision] = useState(0);
  const reports = useResource<{
    items: { name: string; key: string; size: number; created_at: number }[];
  }>("/reports", revision + reportRevision);
  const [period, setPeriod] = useState<ReportPeriod>("day");
  const [format, setFormat] = useState<ReportFormat>("xlsx");
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  useEffect(() => {
    if (resource.data && !loaded.current) {
      loaded.current = true;
      setDraft(resource.data);
      setTime(toTime(resource.data));
    }
  }, [resource.data]);
  const hasAddress = !!address || (!!draft?.webhook_set && !clearAddress);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>报告</h1>
          <p>设置周期汇总投递，或立即生成报告并下载归档。</p>
        </div>
      </div>
      <section className="panel" aria-label="周期报告">
        <h2>周期报告</h2>
        <p>
          选择投递周期并设置企业微信群机器人地址后开启投递；关闭全部周期或未设置地址时不会投递。时间为库存主机本地时间，修改后请保存。
        </p>
        {resource.error && <Notice>{resource.error}</Notice>}
        {resource.data?.last_error && (
          <Notice>最近一次周期报告失败：{resource.data.last_error}</Notice>
        )}
        {action.error && <Notice>{action.error}</Notice>}
        {message && <Notice success>{message}</Notice>}
        {resource.loading && !draft ? (
          <Loading />
        ) : (
          draft && (
            <Form
              onSubmit={(e) =>
                form(e, () =>
                  action.run(async () => {
                    setMessage("");
                    const [hour, minute] = time.split(":").map(Number);
                    const saved = await send<ReportScheduleData>(
                      "/report-schedule",
                      {
                        webhook:
                          address ||
                          (clearAddress ? "" : draft.webhook_set ? "****" : ""),
                        format: draft.format,
                        hour,
                        minute,
                        periods: draft.periods,
                      },
                      "PUT",
                    );
                    setDraft(saved);
                    setTime(toTime(saved));
                    setAddress("");
                    setClearAddress(false);
                    setMessage("周期报告设置已保存。");
                  }),
                )
              }
            >
              <fieldset disabled={action.busy}>
                <legend>投递设置</legend>
                <p className="hint">
                  {!draft.periods.length || !hasAddress
                    ? "当前设置不会投递：请选择至少一个周期并设置企业微信群机器人地址。"
                    : "当前设置已开启投递，将按所选周期和时间发送。"}
                </p>
                <label className="checkbox">
                  <Checkbox
                    aria-label="开启周期报告投递"
                    checked={draft.periods.length > 0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        periods: e.target.checked ? ["day"] : [],
                      })
                    }
                  />
                  开启周期报告投递（关闭会取消全部周期）
                </label>
                {reportPeriods.map((item) => (
                  <label className="checkbox" key={item.value}>
                    <Checkbox
                      aria-label={item.label}
                      checked={draft.periods.includes(item.value)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          periods: e.target.checked
                            ? [...draft.periods, item.value]
                            : draft.periods.filter(
                                (value) => value !== item.value,
                              ),
                        })
                      }
                    />
                    {item.label}
                  </label>
                ))}
                <div className="form-grid">
                  <Field label="投递时间（本地时间）" required>
                    {(p) => (
                      <Input
                        {...p}
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="投递格式"
                    required
                    hint={draft.format === "pdf" ? pdfHint : undefined}
                  >
                    {(p) => (
                      <Select
                        {...p}
                        aria-label="投递格式"
                        value={draft.format}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            format: e.target.value as ReportFormat,
                          })
                        }
                      >
                        <option value="xlsx">Excel</option>
                        <option value="pdf">PDF</option>
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="企业微信群机器人地址"
                    hint={
                      "目前只支持企业微信群机器人；地址从企业微信群 →「群机器人」→ 添加后复制。" +
                      (clearAddress
                        ? "已标记清除地址，保存后生效；输入新地址可替换。"
                        : draft.webhook_set
                          ? "地址已设置，留空提交即保留原值；清除请点旁边的清除按钮。"
                          : "尚未设置地址，不会投递。")
                    }
                  >
                    {(p) => (
                      <Input
                        {...p}
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          draft.webhook_set && !clearAddress
                            ? "****"
                            : "请输入企业微信群机器人地址"
                        }
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <div className="form-actions">
                  <Button
                    onClick={() => {
                      setAddress("");
                      setClearAddress(true);
                      setMessage("");
                    }}
                  >
                    清除地址
                  </Button>
                  <Submit busy={action.busy}>保存周期报告设置</Submit>
                </div>
              </fieldset>
            </Form>
          )
        )}
        <h3>立即生成一份</h3>
        <p className="hint">按所选日期所在的周期生成并归档，不投递到群。</p>
        {generate.error && <Notice>{generate.error}</Notice>}
        {generated && <Notice success>报告已生成，可在归档列表下载。</Notice>}
        <Form
          onSubmit={(e) =>
            form(e, () =>
              generate.run(async () => {
                setGenerated(false);
                await send("/reports", { period, date, format });
                setGenerated(true);
                setReportRevision((value) => value + 1);
              }),
            )
          }
        >
          <fieldset disabled={generate.busy}>
            <legend>生成报告</legend>
            <div className="form-grid">
              <Field label="生成周期" required>
                {(p) => (
                  <Select
                    {...p}
                    aria-label="生成周期"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
                  >
                    {reportPeriods.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="报告日期" required>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="生成格式"
                required
                hint={format === "pdf" ? pdfHint : undefined}
              >
                {(p) => (
                  <Select
                    {...p}
                    aria-label="生成格式"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ReportFormat)}
                  >
                    <option value="xlsx">Excel</option>
                    <option value="pdf">PDF</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="form-actions">
              <Submit busy={generate.busy}>立即生成报告</Submit>
            </div>
          </fieldset>
        </Form>
        <h3>已归档报告</h3>
        {reports.error && <Notice>{reports.error}</Notice>}
        {reports.loading ? (
          <Loading />
        ) : !reports.error && !reports.data?.items.length ? (
          <Empty>暂无已归档报告。</Empty>
        ) : (
          !reports.error && (
            <TableScroll>
              <table className="backup-table" aria-label="已归档报告">
                <thead>
                  <tr>
                    <th>时间 / 文件</th>
                    <th>大小</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.data?.items.map((item) => (
                    <tr key={item.key}>
                      <td data-label="时间 / 文件">
                        <strong>{dateTime(item.created_at)}</strong>
                        <small>{item.name}</small>
                      </td>
                      <td data-label="大小">
                        {Math.ceil(item.size / 1024).toLocaleString()} KB
                      </td>
                      <td className="ledger-actions" data-label="操作">
                        <div className="row-actions">
                          <a
                            className="button small"
                            aria-label={`下载报告 ${item.name}`}
                            href={`/api/reports/${encodeURIComponent(item.name)}`}
                            download
                          >
                            下载报告
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )
        )}
      </section>
    </>
  );
}
