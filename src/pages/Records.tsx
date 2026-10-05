import { Disclosure } from "../ui";
import { Button, Form, Textarea } from "../ui";
import { useState } from "react";
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
  const [tab, setTab] = useState<"documents" | "audit">("documents");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Document>();
  const [reason, setReason] = useState("");
  const action = useAction();
  const docs = useResource<{ items: Document[] }>(
    `/documents?page=${page}`,
    revision,
  );
  const audit = useResource<{ items: Audit[] }>(
    `/audit?page=${page}`,
    revision,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>记录</h1>
          <p>
            {user.role === "admin"
              ? "查看每笔收发和人员操作，历史记录始终保留。"
              : "查看自己登记的收发和操作记录。"}
          </p>
        </div>
      </div>
      <div className="tabs">
        <Button
          className={tab === "documents" ? "active" : ""}
          onClick={() => {
            setTab("documents");
            setPage(1);
          }}
        >
          出入库记录
        </Button>
        <Button
          className={tab === "audit" ? "active" : ""}
          onClick={() => {
            setTab("audit");
            setPage(1);
          }}
        >
          操作记录
        </Button>
      </div>
      <section className="panel">
        {(docs.error || audit.error) && (
          <Notice>{docs.error || audit.error}</Notice>
        )}
        {tab === "documents" ? (
          docs.loading ? (
            <Loading />
          ) : !docs.data?.items.length ? (
            <Empty>还没有出入库记录。</Empty>
          ) : (
            <div className="document-list">
              {docs.data.items.map((doc) => (
                <Button
                  className="document"
                  key={doc.id}
                  onClick={() => {
                    setDetail(doc);
                    setReason("");
                    action.setError("");
                  }}
                >
                  <span
                    className={`badge ${["issue", "shipment", "scrap", "return_out"].includes(doc.kind) ? "amber" : "green"}`}
                  >
                    {movementLabels[doc.kind] ?? doc.kind}
                  </span>
                  <span className="document-body">
                    <strong>{doc.lines.map((l) => l.name).join("、")}</strong>
                    <small>
                      {doc.actor_name} · {dateTime(doc.created_at)} ·{" "}
                      {doc.number}
                    </small>
                  </span>
                  <span>
                    {doc.status === "voided"
                      ? "已作废"
                      : doc.lines.length === 1
                        ? `${doc.lines[0].delta >= 0 ? "+" : "−"}${quantity(Math.abs(doc.lines[0].delta), doc.lines[0].precision)} ${doc.lines[0].unit}`
                        : `${doc.lines.length} 种物料`}
                  </span>
                </Button>
              ))}
            </div>
          )
        ) : audit.loading ? (
          <Loading />
        ) : !audit.data?.items.length ? (
          <Empty>暂无操作记录。</Empty>
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
          <span>第 {page} 页</span>
          <div>
            <Button
              className="button small"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              className="button small"
              disabled={
                (tab === "documents"
                  ? docs.data?.items.length
                  : audit.data?.items.length) !== 50
              }
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
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
          {user.role === "admin" &&
            detail.status === "posted" &&
            !["void", "adjustment"].includes(detail.kind) && (
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
                  <Submit busy={action.busy}>确认作废并调整库存</Submit>
                </Form>
              </Disclosure>
            )}
        </Modal>
      )}
    </>
  );
}
