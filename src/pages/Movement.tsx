import { Button, Input, Form, Select, Textarea } from "../ui";
import { useEffect, useRef, useState } from "react";
import { Search, CheckCircle2, X, ArrowLeft } from "lucide-react";
import {
  type Item,
  type Line,
  type User,
  send,
  quantity,
  movementLabels,
} from "../api";
import {
  Empty,
  Field,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

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
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ item: Item; value: string }[]>(
    initial ? [{ item: initial, value: "" }] : [],
  );
  const [kind, setKind] = useState(direction === "in" ? "receipt" : "issue");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ number: string; lines: Line[] }>();
  const request = useRef(crypto.randomUUID());
  const action = useAction();
  const hasChanges =
    !result &&
    (selected.some((line) => line.value !== "") ||
      person !== "" ||
      note !== "");
  useEffect(() => {
    onDirtyChange(hasChanges);
    return () => onDirtyChange(false);
  }, [hasChanges, onDirtyChange]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, error } = useResource<{ items: Item[] }>(
    `/items?q=${encodeURIComponent(query)}`,
  );
  const incoming = direction === "in";
  const choices = incoming
    ? [
        "receipt",
        "finished",
        ...(user.role === "admin" ? ["return_in", "opening"] : []),
      ]
    : [
        "issue",
        "shipment",
        ...(user.role === "admin" ? ["return_out", "scrap"] : []),
      ];
  function reset() {
    setSelected([]);
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
    <div className="movement-page">
      <div className="page-heading">
        <div>
          <Button className="back-link" onClick={back}>
            <ArrowLeft size={17} />
            返回
          </Button>
          <h1>我要{incoming ? "入库" : "出库"}</h1>
          <p>
            {incoming ? "东西放进仓库，库存增加。" : "东西拿出仓库，库存减少。"}
          </p>
        </div>
      </div>
      <div className="movement-layout">
        <section className="panel picker">
          <h2>1. 找物料</h2>
          <label className="search">
            <Search size={20} />
            <Input
              aria-label="查找要收发的物料"
              placeholder="输入名称、编码或扫描条码"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              enterKeyHint="search"
            />
          </label>
          {error && <Notice>{error}</Notice>}
          <div className="picker-list">
            {data?.items.map((item) => (
              <Button
                key={item.id}
                className="picker-item"
                disabled={item.counting}
                onClick={() => {
                  if (!selected.some((s) => s.item.id === item.id))
                    setSelected((s) => [...s, { item, value: "" }]);
                }}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.spec || item.kind} · {item.code}
                  </small>
                </span>
                <span>
                  {item.counting
                    ? "正在清点"
                    : `${quantity(item.balance, item.precision)} ${item.unit}`}
                  <small>
                    {selected.some((s) => s.item.id === item.id)
                      ? "已添加"
                      : "点击添加"}
                  </small>
                </span>
              </Button>
            ))}
            {data && !data.items.length && (
              <Empty>没有找到物料，请换个关键词。</Empty>
            )}
          </div>
        </section>
        <section className="panel entry">
          <h2>2. 填数量并确认</h2>
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  if (!selected.length)
                    throw new Error("请先从左侧或上方选择物料。");
                  const response = await send<{
                    number: string;
                    lines: Line[];
                  }>("/movements", {
                    request_id: request.current,
                    kind,
                    person,
                    note,
                    lines: selected.map((s) => ({
                      item_id: s.item.id,
                      quantity: s.value,
                    })),
                  });
                  setResult(response);
                  done();
                }),
              )
            }
          >
            <div className="entry-fields">
              {!selected.length && <Empty>先选物料，再填写数量。</Empty>}
              {selected.map(({ item, value }, index) => (
                <div className="selected-item" key={item.id}>
                  <div className="section-title">
                    <strong>{item.name}</strong>
                    <Button
                      type="button"
                      className="icon-button"
                      aria-label={`移除${item.name}`}
                      onClick={() =>
                        setSelected((s) => s.filter((_, i) => i !== index))
                      }
                    >
                      <X size={18} />
                    </Button>
                  </div>
                  <Field
                    label={`${incoming ? "入库" : "出库"}数量 · ${item.unit}`}
                    required
                    hint={`当前库存 ${quantity(item.balance, item.precision)} ${item.unit}；${item.precision === 0 ? "只能填整数" : `最多 ${item.precision} 位小数`}。`}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={value}
                        onChange={(e) =>
                          setSelected((s) =>
                            s.map((line, i) =>
                              i === index
                                ? { ...line, value: e.target.value }
                                : line,
                            ),
                          )
                        }
                        required
                        inputMode={item.precision ? "decimal" : "numeric"}
                        maxLength={16}
                        placeholder="填写本次数量"
                      />
                    )}
                  </Field>
                </div>
              ))}
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
                    required={["scrap", "return_in", "return_out"].includes(
                      kind,
                    )}
                    rows={2}
                  />
                )}
              </Field>
            </div>
            <div className="movement-confirm">
              {action.error && <Notice>{action.error}</Notice>}
              <div className="form-actions">
                <span className="movement-count">
                  已选 {selected.length} 种物料
                </span>
                <Submit busy={action.busy}>
                  确认{incoming ? "入库" : "出库"}
                </Submit>
              </div>
            </div>
          </Form>
        </section>
      </div>
    </div>
  );
}
