import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Form, Input, Checkbox, Textarea, useConfirm } from "../ui";
import {
  Field,
  Modal,
  Notice,
  Submit,
  Loading,
  Empty,
  form,
  useAction,
  TableScroll,
} from "../components";
import { useDictionaryOrder } from "../DictionaryOrder";
import { send, can, dateTime, type User } from "../api";
export interface MaterialOption {
  id: string;
  field: string;
  name: string;
  version: number;
  active: boolean;
  sort: number;
  note: string;
  source: string;
  last_used_at: number | null;
  usage_count: number | null;
}
const sourceLabels: Record<string, string> = {
  manual: "手工录入",
  auto: "自动收录",
  import: "表格导入",
};
const labels = { spec: "常用规格", kind: "物料分类", unit: "计量单位" };
export default function MaterialOptions({
  user,
  field,
  resource,
  refresh,
}: {
  user: User;
  field: keyof typeof labels;
  resource: {
    data?: { items: MaterialOption[] };
    loading: boolean;
    error: string;
  };
  refresh: () => void;
}) {
  const [editing, setEditing] = useState<MaterialOption | "new">();
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [sort, setSort] = useState("0");
  const [note, setNote] = useState("");
  const action = useAction();
  const confirm = useConfirm();
  const rows = resource.data?.items.filter((o) => o.field === field) || [];
  const order = useDictionaryOrder(
    rows,
    field,
    resource.loading,
    can(user, "options.update") && !action.busy,
    refresh,
  );
  return (
    <>
      <div className="section-title ledger-heading">
        <h2>{labels[field]}</h2>
        <p className="muted">
          修改或删除只影响候选列表，物料资料与历史单据保留原值。
        </p>
      </div>
      {resource.error && <Notice>{resource.error}</Notice>}
      {order.error && <Notice>{order.error}</Notice>}
      <p className="dictionary-feedback" role="status">
        {order.message}
      </p>
      {action.error && !editing && <Notice>{action.error}</Notice>}
      {resource.loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>暂无候选选项</Empty>
      ) : (
        <TableScroll>
          <table
            className="dictionary-table material-options-table"
            aria-label={`${labels[field]}列表`}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  className="ledger-sequence dictionary-order-cell"
                >
                  序
                </th>
                <th scope="col">{field === "spec" ? "规格值" : "名称"}</th>
                <th scope="col">状态</th>
                <th scope="col" className="numeric">
                  用到的物料
                </th>
                <th
                  scope="col"
                  title="最近用于新增或改选物料；升级前的时间未知"
                >
                  最近使用
                </th>
                <th scope="col">来源</th>
                <th scope="col">说明</th>
                <th scope="col" className="ledger-actions">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, index) => (
                <tr key={o.id} {...order.rowProps(o)}>
                  <td className="ledger-sequence dictionary-order-cell">
                    {order.controls(o, index)}
                  </td>
                  <td className="ledger-name" data-label="名称">
                    <strong>{o.name}</strong>
                  </td>
                  <td data-label="状态">
                    <span className={`badge${o.active ? " ok" : ""}`}>
                      {o.active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="numeric" data-label="用到的物料">
                    {o.usage_count ?? "—"}
                  </td>
                  <td
                    data-label="最近使用"
                    title="最近用于新增或改选物料；升级前的时间未知"
                  >
                    {o.last_used_at ? dateTime(o.last_used_at) : "—"}
                  </td>
                  <td data-label="来源">{sourceLabels[o.source] || "未知"}</td>
                  <td data-label="说明" className="ledger-note">
                    {o.note || "—"}
                  </td>
                  <td className="ledger-actions">
                    <div className="row-actions">
                      {can(user, "options.update") && (
                        <Button
                          className="button ledger-edit"
                          disabled={action.busy || order.busy}
                          onClick={() =>
                            void action.run(async () => {
                              await send("/material-options", {
                                ...o,
                                active: !o.active,
                              });
                              refresh();
                            })
                          }
                        >
                          {o.active ? "停用" : "启用"}
                        </Button>
                      )}
                      {can(user, "options.update") && (
                        <Button
                          className="button ledger-edit"
                          disabled={action.busy || order.busy}
                          onClick={() => {
                            setName(o.name);
                            setActive(o.active);
                            setSort(String(o.sort));
                            setNote(o.note);
                            setEditing(o);
                            action.setError("");
                          }}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          修改
                        </Button>
                      )}
                      {can(user, "options.delete") && (
                        <Button
                          className="button danger-outline"
                          disabled={action.busy || order.busy}
                          onClick={() =>
                            void action.run(async () => {
                              if (
                                !(await confirm({
                                  title: `删除候选“${o.name}”？`,
                                  description:
                                    "仅从候选列表移除，不删除物料或修改历史业务。再次手输并保存可重新加入。",
                                  confirmLabel: "删除候选",
                                }))
                              )
                                return;
                              await send(
                                `/material-options/${o.id}?version=${o.version}`,
                                {},
                                "DELETE",
                              );
                              refresh();
                            })
                          }
                        >
                          删除候选
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {can(user, "options.create") && (
        <div className="ledger-footer">
          <Button
            className="dictionary-add"
            onClick={() => {
              setName("");
              setActive(true);
              setSort("0");
              setNote("");
              setEditing("new");
              action.setError("");
            }}
          >
            <Plus size={16} aria-hidden="true" />
            新增{labels[field]}
          </Button>
        </div>
      )}
      {editing && (
        <Modal
          title={`${editing === "new" ? "新增" : "修改"}${labels[field]}`}
          onClose={() => setEditing(undefined)}
        >
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  await send("/material-options", {
                    field,
                    name,
                    active,
                    sort: Number(sort),
                    note,
                    ...(editing === "new"
                      ? {}
                      : { id: editing.id, version: editing.version }),
                  });
                  setEditing(undefined);
                  refresh();
                }),
              )
            }
          >
            <Field label="选项名称" required>
              {(p) => (
                <Input
                  {...p}
                  required
                  name="option-name"
                  autoComplete="off"
                  maxLength={field === "unit" ? 16 : 100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="排列顺序"
              hint="0–9999，数字较小的排在前面，也可在列表直接调整。"
            >
              {(p) => (
                <Input
                  {...p}
                  name="option-sort"
                  type="number"
                  min={0}
                  max={9999}
                  step={1}
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                />
              )}
            </Field>
            <Field label="说明">
              {(p) => (
                <Textarea
                  {...p}
                  name="option-note"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <label className="checkbox">
              <Checkbox
                checked={active}
                disabled={!can(user, "options.update")}
                onChange={(e) => setActive(e.target.checked)}
              />
              启用（可用于新物料）
            </label>
            {action.error && <Notice>{action.error}</Notice>}
            <div className="form-actions form-footer">
              <Button onClick={() => setEditing(undefined)}>取消</Button>
              <Submit busy={action.busy}>保存选项</Submit>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
