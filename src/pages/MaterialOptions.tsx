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
  useResource,
} from "../components";
import { send } from "../api";
interface Option {
  id: string;
  field: string;
  name: string;
  version: number;
}
const labels = { spec: "规格", kind: "物料类型", unit: "单位" };
export default function MaterialOptions({
  field,
  revision,
  refresh,
}: {
  field: keyof typeof labels;
  revision: number;
  refresh: () => void;
}) {
  const resource = useResource<{ items: Option[] }>(
    "/material-options",
    revision,
  );
  const [editing, setEditing] = useState<Option | "new">();
  const [name, setName] = useState("");
  const action = useAction();
  const confirm = useConfirm();
  const rows = resource.data?.items.filter((o) => o.field === field) || [];
  return (
    <>
      <div className="section-title">
        <h2>{labels[field]}</h2>
        <Button
          onClick={() => {
            setName("");
            setEditing("new");
            action.setError("");
          }}
        >
          新增{labels[field]}
        </Button>
      </div>
      <p className="muted">
        修改或删除只影响候选列表，物料资料与历史单据保留原值。物料表单可手输新值，保存成功后加入候选。
      </p>
      {resource.error && <Notice>{resource.error}</Notice>}
      {action.error && !editing && <Notice>{action.error}</Notice>}
      {resource.loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>暂无候选选项</Empty>
      ) : (
        rows.map((o) => (
          <div className="sale-revision" key={o.id}>
            <strong>{o.name}</strong>
            <div className="row-actions">
              <Button
                onClick={() => {
                  setName(o.name);
                  setEditing(o);
                  action.setError("");
                }}
              >
                修改
              </Button>
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
            </div>
          </div>
        ))
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
                  autoFocus
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
