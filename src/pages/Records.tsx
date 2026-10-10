import { useQueryValue } from "../navigation";
import { can } from "../api";
import {
  Disclosure,
  Button,
  Input,
  Select,
  Form,
  Textarea,
  Tabs,
  TabsList,
  Tab,
  TabsPanel,
} from "../ui";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { AuditDetails } from "../AuditDetails";
import {
  type User,
  type Document,
  type Audit,
  send,
  quantity,
  dateTime,
  movementLabels,
} from "../api";
import {
  Empty,
  TableScroll,
  Field,
  Loading,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

export default function Records({
  user,
  revision,
  refresh,
}: {
  user: User;
  revision: number;
  refresh: () => void;
}) {
  const [tabValue, setTab] = useQueryValue<string>("records_tab", "documents");
  const tab = tabValue === "audit" ? "audit" : "documents";
  const [page, setPage] = useQueryValue<number>("records_page", 1);
  const [search, setSearch] = useQueryValue<string>("records_q", "");
  const [query, setQuery] = useState(search);
  const [kind, setKind] = useQueryValue<string>("records_kind", "");
  const [auditKind, setAuditKind] = useQueryValue<string>("records_action", "");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const [detail, setDetail] = useState<Document>();
  const [reason, setReason] = useState("");
  const action = useAction();
  const docs = useResource<{ items: Document[]; total: number }>(
    tab === "documents"
      ? `/documents?page=${page}&q=${encodeURIComponent(query)}&kind=${encodeURIComponent(kind)}`
      : undefined,
    revision,
  );
  const audit = useResource<{
    items: Audit[];
    total: number;
    actions: string[];
  }>(
    tab === "audit"
      ? `/audit?page=${page}&q=${encodeURIComponent(query)}&kind=${encodeURIComponent(auditKind)}`
      : undefined,
    revision,
  );
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as "documents" | "audit");
        setPage(1);
      }}
    >
      <div className="page-heading">
        <div>
          <h1>记录</h1>
          <p>
            {can(user, "records.all")
              ? "查看每笔收发和人员操作，历史记录始终保留。"
              : "查看自己登记的收发和操作记录。"}
          </p>
        </div>
        {user.role === "admin" && (
          <a
            className="button"
            href={`/api/export/${tab}?format=csv&q=${encodeURIComponent(query)}&kind=${encodeURIComponent(tab === "documents" ? kind : auditKind)}`}
          >
            导出 CSV
          </a>
        )}
      </div>
      <TabsList aria-label="记录栏目">
        <Tab value="documents">出入库记录</Tab>
        <Tab value="audit">操作记录</Tab>
      </TabsList>
      <TabsPanel value={tab} className="panel ledger-sheet records-sheet">
        <div className="filters">
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <Input
              aria-label="搜索记录"
              name="records-search"
              type="search"
              placeholder={
                tab === "documents"
                  ? "物料、单号或操作人…"
                  : "操作人、动作或详情…"
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {tab === "audit" && (
            <Select
              aria-label="筛选操作类型"
              value={auditKind}
              onChange={(e) => {
                setAuditKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部操作</option>
              {audit.data?.actions?.map((action) => (
                <option key={action} value={action}>
                  {action.replaceAll("盘点", "清点")}
                </option>
              ))}
            </Select>
          )}
        </div>
        {tab === "documents" && (
          <div className="filter-chips" role="group" aria-label="记录类型">
            {[
              ["", "全部"],
              ["in", "入库"],
              ["out", "出库"],
              ["sales", "销售关联"],
              ["void", "作废"],
              ["adjustment", "清点"],
            ].map(([value, label]) => (
              <Button
                key={value}
                className="filter-chip"
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setPage(1);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        {(tab === "documents" ? docs.error : audit.error) && (
          <Notice>{tab === "documents" ? docs.error : audit.error}</Notice>
        )}
        {tab === "documents" ? (
          docs.loading ? (
            <Loading />
          ) : !docs.data?.items.length ? (
            <Empty>
              {query || kind
                ? "没有符合筛选条件的出入库记录。"
                : "还没有出入库记录。"}
            </Empty>
          ) : (
            <TableScroll>
              <table className="records-table" aria-label="出入库记录列表">
                <thead>
                  <tr>
                    <th scope="col">时间</th>
                    <th scope="col">动作</th>
                    <th scope="col">物料 / 单据</th>
                    <th scope="col" className="numeric">
                      增减 / 剩余库存
                    </th>
                    <th scope="col">操作人</th>
                    <th scope="col">说明</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.data.items.flatMap((doc) =>
                    doc.lines.map((line, index) => (
                      <tr key={`${doc.id}-${index}`}>
                        <td data-label="时间">{dateTime(doc.created_at)}</td>
                        <td data-label="动作">
                          <span
                            className={`badge ${line.delta < 0 ? "amber" : "green"}`}
                          >
                            {movementLabels[doc.kind] ?? doc.kind}
                          </span>
                        </td>
                        <td data-label="物料 / 单据">
                          <Button
                            className="record-link"
                            aria-label={`${movementLabels[doc.kind] ?? doc.kind} ${line.name} ${doc.number}`}
                            onClick={() => {
                              setDetail(doc);
                              setReason("");
                              action.setError("");
                            }}
                          >
                            <strong>{line.name}</strong>
                            <small>{doc.number}</small>
                          </Button>
                        </td>
                        <td data-label="增减 / 剩余库存" className="numeric">
                          <strong>
                            {line.delta >= 0 ? "+" : "−"}
                            {quantity(
                              Math.abs(line.delta),
                              line.precision,
                            )}{" "}
                            {line.unit}
                          </strong>
                          <small>
                            结存 {quantity(line.balance_after, line.precision)}{" "}
                            {line.unit}
                          </small>
                        </td>
                        <td data-label="操作人">{doc.actor_name}</td>
                        <td data-label="说明">
                          {doc.note || doc.person || "—"}
                        </td>
                        <td data-label="状态">
                          {doc.status === "voided" ? "已作废" : "已完成"}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </TableScroll>
          )
        ) : audit.loading ? (
          <Loading />
        ) : !audit.data?.items.length ? (
          <Empty>
            {query || auditKind
              ? "没有符合筛选条件的操作记录。"
              : "暂无操作记录。"}
          </Empty>
        ) : (
          <TableScroll>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>做了什么</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.created_at)}</td>
                    <td>{row.actor_name}</td>
                    <td>
                      {row.action
                        .replaceAll("盘点", "清点")
                        .replace("初始化主机", "首次设置管理员")}
                    </td>
                    <td>
                      <Disclosure title="查看详情">
                        <div className="audit-detail">
                          <AuditDetails value={row.details} />
                        </div>
                      </Disclosure>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <div className="pagination">
          <span>
            共{" "}
            {(tab === "documents" ? docs.data?.total : audit.data?.total) ?? 0}{" "}
            笔 · 第 {page} 页
          </span>
          <div>
            <Button
              className="button small"
              disabled={
                page === 1 ||
                (tab === "documents" ? docs.loading : audit.loading) ||
                search !== query
              }
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              className="button small"
              disabled={
                (tab === "documents" ? docs.loading : audit.loading) ||
                search !== query ||
                page * 50 >=
                  ((tab === "documents"
                    ? docs.data?.total
                    : audit.data?.total) ?? 0)
              }
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </TabsPanel>
      {detail && (
        <Modal
          title={movementLabels[detail.kind] ?? "记录详情"}
          onClose={() => setDetail(undefined)}
        >
          <p className="muted">
            {detail.number} · {dateTime(detail.created_at)}
          </p>
          <dl className="detail-grid">
            <dt>登记人</dt>
            <dd>{detail.actor_name}</dd>
            <dt>领用人 / 来源去向</dt>
            <dd>{detail.person || "未填写"}</dd>
            <dt>备注</dt>
            <dd>{detail.note || "未填写"}</dd>
            <dt>状态</dt>
            <dd>
              {detail.status === "voided" ? "已作废，原记录保留" : "已完成"}
            </dd>
          </dl>
          {detail.lines.map((line, index) => (
            <div className="receipt-line" key={index}>
              <strong>{line.name}</strong>
              <span>
                数量：{quantity(line.quantity, line.precision)} {line.unit}
              </span>
              <small>
                本次操作完成后的库存：
                {quantity(line.balance_after, line.precision)} {line.unit}
              </small>
            </div>
          ))}
          {can(user, "records.void") &&
            detail.status === "posted" &&
            !["void", "adjustment", "sales"].includes(detail.kind) && (
              <Disclosure className="more" title="录错了？作废这笔记录">
                <p>
                  作废入库会减去这次入库的数量，作废出库会加回这次出库的数量；原记录仍保留。已有相关退回记录或库存不够扣减时，不能作废。
                </p>
                <Form
                  onSubmit={(e) =>
                    form(e, () =>
                      action.run(async () => {
                        await send(`/documents/${detail.id}/void`, { reason });
                        setDetail(undefined);
                        refresh();
                      }),
                    )
                  }
                >
                  <Field
                    label="作废原因"
                    required
                    hint="例如：数量录错，实际领用 10 个。"
                  >
                    {(p) => (
                      <Textarea
                        {...p}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                        maxLength={500}
                      />
                    )}
                  </Field>
                  {action.error && <Notice>{action.error}</Notice>}
                  <div className="form-actions form-footer">
                    <Submit busy={action.busy}>确认作废并调整库存</Submit>
                  </div>
                </Form>
              </Disclosure>
            )}
        </Modal>
      )}
    </Tabs>
  );
}
