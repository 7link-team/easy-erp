import { can } from "../api";
import { Button, Input, Form, Select, Textarea } from "../ui";
import { useEffect, useRef, useState } from "react";
import { Plus, CheckCircle2, Trash2, ArrowLeft } from "lucide-react";
import {
  type Item,
  type Line,
  type User,
  send,
  quantity,
  movementLabels,
} from "../api";
import { Empty, Field, Notice, Submit, form, useAction } from "../components";
import ItemPicker from "../ItemPicker";

export default function Movement({
  user,
  direction,
  initial,
  done,
  back,
  home,
  onDirtyChange,
}: {
  user: User;
  direction: "in" | "out";
  initial?: Item;
  done: () => void;
  back: () => void;
  home: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState<{ item: Item; value: string }[]>(
    initial ? [{ item: initial, value: "" }] : [],
  );
  const [kind, setKind] = useState(direction === "in" ? "receipt" : "issue");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ number: string; lines: Line[] }>();
  const request = useRef(crypto.randomUUID());
  const action = useAction();
  const [pendingLine, setPendingLine] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItemId, setPickerItemId] = useState<string>();
  const selectedItem = useRef<string | undefined>(undefined);
  const linesElement = useRef<HTMLDivElement>(null);
  const picker = (
    p: { id: string; "aria-describedby"?: string },
    item?: Item,
  ) => (
    <ItemPicker
      id={p.id}
      describedBy={p["aria-describedby"]}
      name={item?.name}
      open={pickerOpen && pickerItemId === item?.id}
      onOpenChange={(open) => {
        if (open) {
          selectedItem.current = undefined;
          setPickerItemId(item?.id);
        }
        setPickerOpen(open);
      }}
      allowZeroStock={direction === "in"}
      searchLabel="查找要收发的物料"
      selectedIds={selected.map((line) => line.item.id)}
      onSelect={(next) => {
        selectedItem.current = next.id;
        setSelected((lines) =>
          item
            ? lines.map((line) =>
                line.item.id === item.id ? { item: next, value: "" } : line,
              )
            : [...lines, { item: next, value: "" }],
        );
        setPickerOpen(false);
        if (!item) setPendingLine(false);
      }}
      onCloseAutoFocus={(event) => {
        if (selectedItem.current) {
          const input = linesElement.current?.querySelector<HTMLInputElement>(
            `[data-item-id="${CSS.escape(selectedItem.current)}"] input`,
          );
          if (input) {
            event.preventDefault();
            input.focus();
          }
        }
      }}
    />
  );
  const hasChanges =
    !result &&
    (pendingLine ||
      selected.some((line) => line.value !== "") ||
      person !== "" ||
      note !== "");
  useEffect(() => {
    onDirtyChange(hasChanges);
    return () => onDirtyChange(false);
  }, [hasChanges, onDirtyChange]);
  const incoming = direction === "in";
  const choices = incoming
    ? [
        "receipt",
        "finished",
        ...(can(user, "movement.special") ? ["return_in", "opening"] : []),
      ]
    : [
        "issue",
        "shipment",
        ...(can(user, "movement.special") ? ["return_out", "scrap"] : []),
      ];
  function reset() {
    setSelected([]);
    setPendingLine(false);
    setPickerOpen(false);
    setPerson("");
    setNote("");
    setResult(undefined);
    request.current = crypto.randomUUID();
    action.setError("");
  }
  if (result)
    return (
      <section className="panel complete">
        <CheckCircle2 size={52} />
        <h1>{incoming ? "入库" : "出库"}已完成</h1>
        <p>记录号：{result.number}</p>
        {result.lines.map((line) => (
          <div key={line.item_id} className="receipt-line">
            <strong>{line.name}</strong>
            <span>
              已{incoming ? "入库" : "出库"}{" "}
              {quantity(line.quantity, line.precision)} {line.unit}
            </span>
            <small>
              本次操作完成后的库存：
              {quantity(line.balance_after, line.precision)} {line.unit}
            </small>
          </div>
        ))}
        <div className="form-actions">
          <Button className="button" onClick={home}>
            返回工作台
          </Button>
          <Button className="button primary" onClick={reset}>
            继续{incoming ? "入库" : "出库"}
          </Button>
        </div>
      </section>
    );
  return (
    <section className="panel movement-page document-editor">
      <div className="section-title">
        <h1>我要{incoming ? "入库" : "出库"}</h1>
        <Button onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回
        </Button>
      </div>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              if (pendingLine)
                throw new Error("请先选择新增行的物料，或删除空行。");
              if (!selected.length) throw new Error("请先添加一行并选择物料。");
              const response = await send<{ number: string; lines: Line[] }>(
                "/movements",
                {
                  request_id: request.current,
                  kind,
                  person,
                  note,
                  lines: selected.map((line) => ({
                    item_id: line.item.id,
                    quantity: line.value,
                  })),
                },
              );
              setResult(response);
              done();
            }),
          )
        }
      >
        <div className="document-fields entry-fields">
          <section
            className="document-section document-material-section"
            aria-labelledby="movement-lines-heading"
          >
            <div className="document-section-heading">
              <h2 id="movement-lines-heading">
                <span aria-hidden="true">01</span>物料明细
              </h2>
              <span role="status">已添加 {selected.length} 种</span>
            </div>
            {!selected.length && !pendingLine && (
              <Empty>点击“添加一行”，选择物料后填写本次数量。</Empty>
            )}
            <div className="document-lines" ref={linesElement}>
              {selected.map(({ item, value }, index) => (
                <div
                  className="document-line document-line-quantity"
                  key={item.id}
                  data-item-id={item.id}
                >
                  <div className="document-line-title">
                    <Field label="物料" required>
                      {(p) => picker(p, item)}
                    </Field>
                    <small>
                      {item.spec || item.kind} · {item.code} · {item.unit}
                    </small>
                    <small>
                      当前库存：{quantity(item.balance, item.precision)}{" "}
                      {item.unit}
                    </small>
                  </div>
                  <Field
                    label={`${incoming ? "入库" : "出库"}数量 · ${item.unit}`}
                    required
                    hint={
                      item.precision === 0
                        ? "只能填整数"
                        : `最多 ${item.precision} 位小数`
                    }
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={value}
                        onChange={(e) =>
                          setSelected((lines) =>
                            lines.map((line, i) =>
                              i === index
                                ? { ...line, value: e.target.value }
                                : line,
                            ),
                          )
                        }
                        required
                        inputMode={item.precision ? "decimal" : "numeric"}
                        maxLength={16}
                        placeholder="例如：10…"
                      />
                    )}
                  </Field>
                  <div className="document-line-actions">
                    <Button
                      className="button small document-line-delete"
                      aria-label={`移除${item.name}`}
                      onClick={() =>
                        setSelected((lines) =>
                          lines.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              {pendingLine && (
                <div className="document-line document-line-quantity">
                  <div className="document-line-title">
                    <Field label="物料" required>
                      {(p) => picker(p)}
                    </Field>
                  </div>
                  <Field label={`${incoming ? "入库" : "出库"}数量`} required>
                    {(p) => <Input {...p} disabled placeholder="先选择物料…" />}
                  </Field>
                  <div className="document-line-actions">
                    <Button
                      className="button small document-line-delete"
                      aria-label="移除空行"
                      onClick={() => {
                        setPendingLine(false);
                        setPickerOpen(false);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      删除
                    </Button>
                  </div>
                </div>
              )}
              {!pendingLine && (
                <Button
                  className="button document-add-line"
                  onClick={() => {
                    selectedItem.current = undefined;
                    setPickerItemId(undefined);
                    setPendingLine(true);
                    setPickerOpen(true);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  添加一行
                </Button>
              )}
            </div>
          </section>
          <section
            className="document-section"
            aria-labelledby="movement-details-heading"
          >
            <div className="document-section-heading">
              <h2 id="movement-details-heading">
                <span aria-hidden="true">02</span>登记信息
              </h2>
            </div>
            <div className="form-grid">
              <Field label="用途" required>
                {(p) => (
                  <Select
                    {...p}
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {choices.map((k) => (
                      <option key={k} value={k}>
                        {movementLabels[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={kind === "issue" ? "领用人" : incoming ? "来源" : "去向"}
                help="实际领走或送来物料的人。本次操作记录始终保留当前登录人的姓名。"
                hint={`本次登记人：${user.name}`}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                    maxLength={100}
                  />
                )}
              </Field>
            </div>
            <Field
              label="备注或原因"
              required={["scrap", "return_in", "return_out"].includes(kind)}
              hint={
                kind === "opening"
                  ? "仅用于尚无历史记录的物料。已有库存请使用清点库存。"
                  : "例如：用于 2 号设备维修。"
              }
            >
              {(p) => (
                <Textarea
                  {...p}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  required={["scrap", "return_in", "return_out"].includes(kind)}
                  rows={2}
                />
              )}
            </Field>
          </section>
        </div>
        <div className="form-actions form-footer">
          {action.error && <Notice>{action.error}</Notice>}
          <Button onClick={back} disabled={action.busy}>
            取消
          </Button>
          <Submit busy={action.busy}>确认{incoming ? "入库" : "出库"}</Submit>
        </div>
      </Form>
    </section>
  );
}
