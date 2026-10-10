import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Form, Input, useConfirm } from "../ui";
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
import { send, can, type User } from "../api";
export interface MaterialOption {
  id: string;
  field: string;
  name: string;
  version: number;
}
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
  const action = useAction();
  const confirm = useConfirm();
  const rows = resource.data?.items.filter((o) => o.field === field) || [];
  return (
    <>
      <div className="section-title ledger-heading">
        <h2>{labels[field]}</h2>
        <p className="muted">
          修改或删除只影响候选列表，物料资料与历史单据保留原值。
        </p>
      </div>
      {resource.error && <Notice>{resource.error}</Notice>}
      {action.error && !editing && <Notice>{action.error}</Notice>}
      {resource.loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>暂无候选选项</Empty>
      ) : (
        <TableScroll>
          <table
            className="dictionary-table"
            aria-label={`${labels[field]}列表`}
          >
            <thead>
              <tr>
                <th scope="col" className="ledger-sequence">
                  序
                </th>
                <th scope="col">{field === "spec" ? "规格值" : "名称"}</th>
                <th scope="col" className="ledger-actions">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, index) => (
                <tr key={o.id}>
                  <td className="ledger-sequence">{index + 1}</td>
                  <td className="ledger-name" data-label="名称">
                    <strong>{o.name}</strong>
                  </td>
                  <td className="ledger-actions">
                    <div className="row-actions">
                      {can(user, "options.update") && (
                        <Button
                          className="button ledger-edit"
                          onClick={() => {
                            setName(o.name);
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
                          disabled={action.busy}
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
