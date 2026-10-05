import { Button, Form, Input, Checkbox, Textarea } from "../ui";
import { useEffect, useState } from "react";
import {
  type User,
  type Item,
  type Stocktake,
  send,
  quantity,
  dateTime,
} from "../api";
import {
  Empty,
  Field,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

export default function Stocktakes({
  user,
  revision,
  refresh,
}: {
  user: User;
  revision: number;
  refresh: () => void;
}) {
  const counts = useResource<{ items: Stocktake[] }>("/stocktakes", revision);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const materials = useResource<{ items: Item[]; total: number }>(
    `/items?q=${encodeURIComponent(query)}&page=${page}`,
    revision,
  );
  const [starting, setStarting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [editing, setEditing] = useState<Stocktake>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const action = useAction();
  const open = (count: Stocktake) => {
    setEditing(count);
    setValues(
      Object.fromEntries(
        count.lines.map((l) => [
          l.item_id,
          l.actual >= 0 ? quantity(l.actual, l.precision) : "",
        ]),
      ),
    );
    setReason("");
    action.setError("");
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>清点库存</h1>
          <p>填写实际数到的数量，管理员确认后更新库存。</p>
        </div>
        {user.role === "admin" && (
          <Button
            className="button primary"
            onClick={() => {
              setStarting(true);
              setChosen([]);
              setSearch("");
              setPage(1);
            }}
          >
            开始清点
          </Button>
        )}
      </div>
      <section className="panel">
        {counts.error && <Notice>{counts.error}</Notice>}
        {!counts.data?.items.length ? (
          <Empty>暂无清点。由管理员选择物料开始清点。</Empty>
        ) : (
          counts.data.items.map((count) => (
            <Button
              className="document stocktake-document"
              key={count.id}
              onClick={() => open(count)}
            >
              <span
                className={`badge ${count.status === "open" ? "amber" : ""}`}
              >
                {
                  {
                    open: "正在清点",
                    completed: "已完成",
                    cancelled: "已取消",
                  }[count.status]
                }
              </span>
              <span className="document-body">
                <small>
                  {dateTime(count.created_at)} · {count.lines.length} 种物料
                </small>
                {count.lines.map((line) => (
                  <span className="stocktake-line" key={line.item_id}>
                    <strong>
                      {line.name} · {line.code}
                    </strong>
                    <span className="stocktake-quantities">
                      <span>
                        清点前 {quantity(line.expected, line.precision)}{" "}
                        {line.unit}
                      </span>
                      <span>
                        实点{" "}
                        {line.actual < 0
                          ? "未填写"
                          : `${quantity(line.actual, line.precision)} ${line.unit}`}
                      </span>
                      <span>
                        {line.actual < 0
                          ? "差异待清点"
                          : line.actual === line.expected
                            ? "数量一致"
                            : `${line.actual > line.expected ? "多" : "少"} ${quantity(Math.abs(line.actual - line.expected), line.precision)} ${line.unit}`}
                      </span>
                    </span>
                  </span>
                ))}
              </span>
              <span>查看</span>
            </Button>
          ))
        )}
      </section>
      {starting && (
        <Modal title="选择要清点的物料" onClose={() => setStarting(false)}>
          <p>清点期间这些物料暂停收发，请同时暂停现场搬入搬出。</p>
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  await send("/stocktakes", { item_ids: chosen });
                  setStarting(false);
                  refresh();
                }),
              )
            }
          >
            <Field
              label="查找清点物料"
              hint="可按名称或编码搜索；切换页面会保留已勾选的物料。"
            >
              {(p) => (
                <Input
                  {...p}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
            </Field>
            {materials.error && <Notice>{materials.error}</Notice>}
            <div className="selection-list" aria-busy={materials.loading}>
              {materials.data?.items
                .filter((i) => !i.counting)
                .map((i) => (
                  <label key={i.id} className="checkbox">
                    <Checkbox
                      checked={chosen.includes(i.id)}
                      onChange={(e) =>
                        setChosen((ids) =>
                          e.target.checked
                            ? [...ids, i.id]
                            : ids.filter((id) => id !== i.id),
                        )
                      }
                    />
                    <span className="stocktake-choice">
                      <strong>
                        {i.name} · {i.spec || "未填写规格"}
                      </strong>
                      <span>
                        {i.code} · 当前库存 {quantity(i.balance, i.precision)}{" "}
                        {i.unit}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
            {!materials.loading && !materials.data?.items.length && (
              <Empty>没有找到物料，请换个关键词。</Empty>
            )}
            <div className="pagination">
              <span>
                第 {page} 页 · 已选 {chosen.length} 种
              </span>
              <div>
                <Button
                  type="button"
                  className="button small"
                  disabled={page === 1 || materials.loading || search !== query}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  className="button small"
                  disabled={
                    materials.loading ||
                    search !== query ||
                    page * 50 >= (materials.data?.total ?? 0)
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
            {action.error && <Notice>{action.error}</Notice>}
            <div className="form-actions">
              <Submit busy={action.busy}>
                开始清点 {chosen.length} 种物料
              </Submit>
            </div>
          </Form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing.status === "open" ? "填写清点数量" : "清点记录"}
          onClose={() => setEditing(undefined)}
        >
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  await send(
                    `/stocktakes/${editing.id}/counts`,
                    {
                      lines: editing.lines.map((l) => ({
                        item_id: l.item_id,
                        quantity: values[l.item_id],
                      })),
                    },
                    "PUT",
                  );
                  setEditing(undefined);
                  refresh();
                }),
              )
            }
          >
            {editing.lines.map((line) => (
              <Field
                key={line.item_id}
                label={`${line.name} · 实际数量（${line.unit}）`}
                required
                hint={`系统记录数量 ${quantity(line.expected, line.precision)} ${line.unit}；没有请填 0，不能留空。`}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode={line.precision ? "decimal" : "numeric"}
                    required
                    value={values[line.item_id] ?? ""}
                    readOnly={editing.status !== "open"}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [line.item_id]: e.target.value,
                      }))
                    }
                  />
                )}
              </Field>
            ))}
            {action.error && <Notice>{action.error}</Notice>}
            {editing.status === "open" && (
              <div className="form-actions">
                <Submit busy={action.busy}>保存清点数量</Submit>
              </div>
            )}
          </Form>
          {editing.status === "open" && user.role === "admin" && (
            <section className="section-divider">
              <h3>管理员确认</h3>
              <p className="hint">
                请先保存上面的清点数量，再确认。确认后按实际数量更新库存。
              </p>
              <Field
                label="差异原因"
                hint="实际清点数量与系统记录不一致时，请填写原因。"
              >
                {(p) => (
                  <Textarea
                    {...p}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
              <div className="form-actions">
                <Button
                  className="button"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await send(`/stocktakes/${editing.id}/finish`, {
                        confirm: false,
                        reason,
                      });
                      setEditing(undefined);
                      refresh();
                    })
                  }
                >
                  取消清点，恢复收发
                </Button>
                <Button
                  className="button primary"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await send(`/stocktakes/${editing.id}/finish`, {
                        confirm: true,
                        reason,
                      });
                      setEditing(undefined);
                      refresh();
                    })
                  }
                >
                  确认并更新库存
                </Button>
              </div>
            </section>
          )}
        </Modal>
      )}
    </>
  );
}
