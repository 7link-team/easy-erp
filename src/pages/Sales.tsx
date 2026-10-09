import { useEffect, useRef, useState } from "react";
import { Plus, Search, Printer, ArrowLeft, X } from "lucide-react";
import {
  Button,
  Input,
  Select,
  Textarea,
  Form,
  Checkbox,
  useConfirm,
} from "../ui";
import {
  Field,
  Notice,
  Submit,
  Modal,
  TableScroll,
  Loading,
  form,
  useAction,
  useResource,
  Empty,
} from "../components";
import { api, send, quantity, dateTime, type User, type Item } from "../api";
import {
  moneyText,
  decimalText,
  localDate,
  saleStatus,
  preview,
  type CatalogEntry,
  type Sale,
  type SaleInput,
  type Finance,
} from "../sales";
import SalesPrint from "./SalesPrint";
import "../sales.css";

function TextField({
  label,
  value,
  onChange,
  required = false,
  decimal = false,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  decimal?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      {(p) => (
        <Input
          {...p}
          type={type}
          inputMode={decimal ? "decimal" : undefined}
          value={value}
          required={required}
          maxLength={type === "date" ? undefined : decimal ? 24 : 200}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
function ConfigForm({
  kind,
  entry,
  onDone,
  onClose,
  catalog,
}: {
  catalog: CatalogEntry[];
  kind: CatalogEntry["kind"];
  entry?: CatalogEntry;
  onDone: () => void;
  onClose: () => void;
}) {
  const [department, setDepartment] = useState(entry?.data.department_id || "");
  const [name, setName] = useState(entry?.name || "");
  const [phone, setPhone] = useState(entry?.data.phone || "");
  const [contact, setContact] = useState(entry?.data.contact || "");
  const [address, setAddress] = useState(entry?.data.address || "");
  const [billable, setBillable] = useState(entry?.data.billable ?? true);
  const [active, setActive] = useState(entry?.active ?? true);
  const [sort, setSort] = useState(String(entry?.data.sort ?? 0));
  const action = useAction();
  const title = {
    customer: "客户",
    type: "单据类型",
    account: "收款账户",
    company: "公司信息",
    department: "部门",
    salesperson: "业务员",
  }[kind];
  return (
    <Modal title={`${entry ? "修改" : "新增"}${title}`} onClose={onClose}>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              await send("/sales/catalog", {
                id: entry?.id || "",
                version: entry?.version || 0,
                kind,
                name,
                active,
                data: {
                  phone,
                  contact,
                  address,
                  billable,
                  sort: Number(sort),
                  department_id: department,
                },
              });
              onDone();
            }),
          )
        }
      >
        <TextField
          label={`${title}名称`}
          value={name}
          onChange={setName}
          required
        />
        {kind === "salesperson" && (
          <Field label="所属部门" required>
            {(p) => (
              <Select
                {...p}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">请选择部门</option>
                {catalog
                  .filter(
                    (c) =>
                      c.kind === "department" &&
                      (c.active || c.id === department),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!c.active && "（停用）"}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {(kind === "customer" || kind === "company") && (
          <>
            <TextField label="联系人" value={contact} onChange={setContact} />
            <TextField label="联系电话" value={phone} onChange={setPhone} />
            <TextField label="地址" value={address} onChange={setAddress} />
          </>
        )}
        {kind === "type" && (
          <>
            <label className="check">
              <Checkbox
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
              />
              计款（产生应收与欠款）
            </label>
            <TextField
              label="排列顺序"
              value={sort}
              onChange={setSort}
              decimal
              hint="0–9999，数字较小的排在前面"
            />
            <p className="muted">
              所有类型确认后都会扣库存。名称仅用于区分单据。
            </p>
          </>
        )}
        {kind !== "company" && (
          <label className="check">
            <Checkbox
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            启用
          </label>
        )}
        {action.error && <Notice>{action.error}</Notice>}
        <Submit busy={action.busy}>保存配置</Submit>
      </Form>
    </Modal>
  );
}

function SaleEditor({
  user,
  sale,
  catalog,
  onDone,
  onClose,
  onDirtyChange,
  onNewCustomer,
}: {
  user: User;
  sale?: Sale;
  catalog: CatalogEntry[];
  onDone: (sale: Sale) => void;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onNewCustomer: () => void;
}) {
  const initial: SaleInput = {
    customer_id: sale?.customer_id || "",
    department_id: sale?.department_id || "",
    salesperson_id: sale?.salesperson_id || "",
    type_id:
      sale?.type_id ||
      catalog.find((c) => c.id === "sale" && c.active)?.id ||
      catalog
        .filter((c) => c.kind === "type" && c.active)
        .sort((a, b) => (a.data.sort ?? 0) - (b.data.sort ?? 0))[0]?.id ||
      "sale",
    business_date: sale?.business_date || localDate(),
    note: sale?.note || "",
    discount_rate: sale ? decimalText(sale.discount_rate, 2) : "100",
    rounding: sale ? decimalText(sale.rounding, 2) : "0",
    lines:
      sale?.lines.map((l) => ({
        item_id: l.item_id,
        quantity: decimalText(l.quantity, 3),
        price: decimalText(l.price, 4),
      })) || [],
  };
  const [input, setInput] = useState(initial);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [reason, setReason] = useState("");
  const [account, setAccount] = useState("");
  const [refundDate, setRefundDate] = useState(localDate());
  const action = useAction();
  const [material, setMaterial] = useState<Record<string, Item>>({});
  const [changed, setChanged] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setItemPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  const items = useResource<{ items: Item[]; total: number }>(
    `/items?q=${encodeURIComponent(query)}&page=${itemPage}`,
  );
  useEffect(() => {
    if (items.data)
      setMaterial((m) => ({
        ...m,
        ...Object.fromEntries(items.data!.items.map((i) => [i.id, i])),
      }));
  }, [items.data]);
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);
  const change = (key: keyof SaleInput, value: SaleInput[keyof SaleInput]) => {
    setChanged(true);
    setInput((s) => ({ ...s, [key]: value }));
  };
  const typ = catalog.find((c) => c.id === input.type_id);
  const billable =
    sale && sale.type_id === input.type_id
      ? sale.billable
      : (typ?.data.billable ?? false);
  const amounts = preview(input, billable);
  const posted = sale?.status === "posted";
  const options = (kind: CatalogEntry["kind"], selected: string) =>
    catalog.filter((c) => c.kind === kind && (c.active || c.id === selected));
  async function save(actionName: string) {
    const payload = {
      sale_id: sale?.id || "",
      version: sale?.version || 0,
      action: actionName,
      input,
      reason,
      account_id: account,
      business_date: refundDate,
    };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    const result = await send<Sale>("/sales/commands", {
      ...payload,
      request_id: request.current!.id,
    });
    onDirtyChange(false);
    onDone(await api<Sale>(`/sales/${result.id}`));
  }
  return (
    <section className="panel sale-editor">
      <div className="section-title">
        <h2>{sale ? (posted ? "修订单据" : "编辑草稿") : "新建单据"}</h2>
        <Button className="button" onClick={onClose}>
          <ArrowLeft size={16} />
          返回单据
        </Button>
      </div>
      <Form
        onSubmit={(e) =>
          form(e, () => action.run(() => save(posted ? "revise" : "confirm")))
        }
      >
        <div className="form-grid">
          <Field label="单据类型" required>
            {(p) => (
              <Select
                {...p}
                value={input.type_id}
                onChange={(e) => {
                  change("type_id", e.target.value);
                  if (
                    !catalog.find((c) => c.id === e.target.value)?.data.billable
                  ) {
                    change("discount_rate", "100");
                    change("rounding", "0");
                  }
                }}
              >
                {options("type", input.type_id)
                  .sort((a, b) => (a.data.sort ?? 0) - (b.data.sort ?? 0))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="客户" required>
            {(p) => (
              <Select
                {...p}
                value={input.customer_id}
                onChange={(e) => change("customer_id", e.target.value)}
              >
                <option value="">请选择客户</option>
                {options("customer", input.customer_id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.data.phone ? ` · ${c.data.phone}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button className="button" onClick={onNewCustomer}>
            快速新增客户
          </Button>
          <Field
            label="业绩部门"
            hint="先选部门，再选该部门业务员。与开单人分别记录。"
          >
            {(p) => (
              <Select
                {...p}
                value={input.department_id || ""}
                onChange={(e) => {
                  setChanged(true);
                  setInput((v) => ({
                    ...v,
                    department_id: e.target.value,
                    salesperson_id: "",
                  }));
                }}
              >
                <option value="">未指定</option>
                {options("department", input.department_id || "").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="部门业务员" required={!!input.department_id}>
            {(p) => (
              <Select
                {...p}
                value={input.salesperson_id || ""}
                disabled={!input.department_id}
                onChange={(e) => change("salesperson_id", e.target.value)}
              >
                <option value="">请选择业务员</option>
                {options("salesperson", input.salesperson_id || "")
                  .filter(
                    (c) =>
                      c.data.department_id === input.department_id ||
                      (c.id === sale?.salesperson_id &&
                        input.department_id === sale?.department_id),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <TextField
            label="业务日期"
            type="date"
            value={input.business_date}
            onChange={(v) => change("business_date", v)}
            required
          />
        </div>
        <h3>选择物料</h3>
        <label className="search">
          <Search size={18} />
          <Input
            aria-label="开单查找物料"
            placeholder="名称、编码或条码"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {items.error && <Notice>{items.error}</Notice>}
        <div className="sale-picker">
          {items.data?.items.map((i) => (
            <Button
              key={i.id}
              className="button"
              disabled={
                i.counting || input.lines.some((l) => l.item_id === i.id)
              }
              onClick={() =>
                change("lines", [
                  ...input.lines,
                  { item_id: i.id, quantity: "1", price: "" },
                ])
              }
            >
              {i.name} · 库存 {quantity(i.balance, i.precision)} {i.unit}
              {i.counting ? " · 正在清点" : ""}
            </Button>
          ))}
        </div>
        <div className="form-actions">
          <Button
            className="button small"
            disabled={itemPage === 1}
            onClick={() => setItemPage((n) => n - 1)}
          >
            上一页物料
          </Button>
          <span>第 {itemPage} 页</span>
          <Button
            className="button small"
            disabled={itemPage * 50 >= (items.data?.total ?? 0)}
            onClick={() => setItemPage((n) => n + 1)}
          >
            下一页物料
          </Button>
        </div>
        {!input.lines.length && (
          <Empty>选择物料后，在下面逐行填写数量和单价。</Empty>
        )}
        <div className="sale-lines">
          {input.lines.map((l, i) => {
            const item = material[l.item_id];
            const prior = sale?.lines.find((x) => x.item_id === l.item_id);
            const name = item?.name || prior?.name || l.item_id;
            return (
              <div className="sale-line" key={l.item_id}>
                <div className="sale-line-title">
                  <strong>{name}</strong>
                  <small>
                    {item?.spec || prior?.spec} · {item?.unit || prior?.unit}
                  </small>
                  {item && (
                    <small>
                      当前库存：{quantity(item.balance, item.precision)}
                      {item.unit}
                    </small>
                  )}
                  <Button
                    className="icon-button"
                    aria-label={`移除${name}`}
                    onClick={() =>
                      change(
                        "lines",
                        input.lines.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <X size={16} />
                  </Button>
                </div>
                <TextField
                  label={`${name} 数量`}
                  value={l.quantity}
                  decimal
                  required
                  onChange={(v) =>
                    change(
                      "lines",
                      input.lines.map((x, j) =>
                        j === i ? { ...x, quantity: v } : x,
                      ),
                    )
                  }
                  hint={
                    item?.precision === 0
                      ? "只能填写整数"
                      : `最多 ${item?.precision ?? 3} 位小数`
                  }
                />
                {billable && (
                  <>
                    <TextField
                      label={`${name} 单价`}
                      value={l.price}
                      decimal
                      required
                      onChange={(v) =>
                        change(
                          "lines",
                          input.lines.map((x, j) =>
                            j === i ? { ...x, price: v } : x,
                          ),
                        )
                      }
                      hint="元，最多 4 位小数"
                    />
                    <div className="sale-line-amount">
                      金额：
                      {amounts ? `¥${moneyText(amounts.amounts[i])}` : "待填写"}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {billable && (
          <>
            <div className="form-grid">
              {user.role === "admin" ? (
                <>
                  <TextField
                    label="折扣率 %"
                    value={input.discount_rate}
                    decimal
                    onChange={(v) => change("discount_rate", v)}
                    required
                    hint="100 为原价，90 为九折"
                  />
                  <TextField
                    label="抹零金额"
                    value={input.rounding}
                    decimal
                    onChange={(v) => change("rounding", v)}
                    required
                    hint="元，不能超过折后金额"
                  />
                </>
              ) : (
                <p className="muted">优惠和收款由管理员处理。</p>
              )}
            </div>
            <div className="sale-amounts">
              <span>
                原金额：¥{amounts ? moneyText(amounts.subtotal) : "—"}
              </span>
              <span>折扣：¥{amounts ? moneyText(amounts.discount) : "—"}</span>
              <span>抹零：¥{amounts ? moneyText(amounts.rounding) : "—"}</span>
              <strong>应收：¥{amounts ? moneyText(amounts.total) : "—"}</strong>
            </div>
          </>
        )}
        <Field label="备注">
          {(p) => (
            <Textarea
              {...p}
              maxLength={500}
              value={input.note}
              onChange={(e) => change("note", e.target.value)}
            />
          )}
        </Field>
        {posted && (
          <>
            <TextField
              label="修订原因"
              value={reason}
              onChange={(v) => {
                setChanged(true);
                setReason(v);
              }}
              required
            />
            {sale.paid > 0 && (
              <>
                <p className="muted">
                  如果新应收低于净实收，保存时会同步登记超收差额退款。请确认实际退款后选择账户。
                </p>
                <Field label="差额退款账户">
                  {(p) => (
                    <Select
                      {...p}
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    >
                      <option value="">无退款时可留空</option>
                      {options("account", account).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <TextField
                  label="退款日期"
                  type="date"
                  value={refundDate}
                  onChange={setRefundDate}
                />
              </>
            )}
          </>
        )}
        {action.error && <Notice>{action.error}</Notice>}
        <div className="form-actions">
          {!posted && (
            <Button
              className="button"
              disabled={action.busy}
              onClick={() => action.run(() => save("save"))}
            >
              保存草稿
            </Button>
          )}
          <Submit busy={action.busy}>
            {posted ? "保存修订" : "确认开单并扣库存"}
          </Submit>
        </div>
      </Form>
    </section>
  );
}

function Operation({
  mode,
  sale,
  catalog,
  onDone,
  onClose,
}: {
  mode: string;
  sale: Sale;
  catalog: CatalogEntry[];
  onDone: (sale: Sale) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(
    mode === "pay" ? decimalText(sale.debt, 2) : "0",
  );
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(localDate());
  const [reason, setReason] = useState("");
  const [cashId, setCashId] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const action = useAction();
  const request = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const title =
    (
      {
        pay: "登记收款",
        refund: "登记退款",
        correct: "更正收款流水",
        void: "作废单据",
        return: "办理退货",
      } as Record<string, string>
    )[mode] || "单据操作";
  const accounts = catalog.filter((c) => c.kind === "account" && c.active);
  return (
    <Modal title={title} onClose={onClose}>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              const payload = {
                sale_id: sale.id,
                version: sale.version,
                action: mode,
                amount,
                account_id: account,
                business_date: date,
                reason,
                cash_id: cashId,
                lines: Object.entries(counts)
                  .filter(([, v]) => v !== "" && v !== "0")
                  .map(([item_id, quantity]) => ({ item_id, quantity })),
              };
              const fingerprint = JSON.stringify(payload);
              if (request.current?.fingerprint !== fingerprint)
                request.current = { fingerprint, id: crypto.randomUUID() };
              const r = await send<Sale>("/sales/commands", {
                ...payload,
                request_id: request.current!.id,
              });
              onDone(await api<Sale>(`/sales/${r.id}`));
            }),
          )
        }
      >
        <p>
          应收 ¥{moneyText(sale.due)} · 净实收 ¥{moneyText(sale.paid)} · 欠款 ¥
          {moneyText(sale.debt)}
        </p>
        {mode === "correct" && (
          <Field label="原流水" required>
            {(p) => (
              <Select
                {...p}
                value={cashId}
                onChange={(e) => {
                  setCashId(e.target.value);
                  const pay = sale.payments.find(
                    (x) => x.id === e.target.value,
                  );
                  if (pay) {
                    setAmount(decimalText(Math.abs(pay.amount), 2));
                    setAccount(pay.account_id);
                  }
                }}
              >
                <option value="">请选择要更正的流水</option>
                {sale.payments
                  .filter(
                    (p) =>
                      !p.reversal_of &&
                      !sale.payments.some((r) => r.reversal_of === p.id),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.business_date} · {p.account_name} ·{" "}
                      {moneyText(p.amount)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {["pay", "refund", "correct"].includes(mode) && (
          <TextField
            label={mode === "correct" ? "更正后金额" : "金额"}
            value={amount}
            onChange={setAmount}
            required
            decimal
            hint={mode === "correct" ? "填 0 表示冲销该流水" : "人民币元"}
          />
        )}
        {mode === "return" &&
          sale.lines.map((l) => (
            <TextField
              key={l.item_id}
              label={`${l.name} 退货数量`}
              value={counts[l.item_id] || ""}
              onChange={(v) => setCounts((c) => ({ ...c, [l.item_id]: v }))}
              decimal
              hint={`剩余可退 ${decimalText(l.quantity - (sale.returned[l.item_id]?.quantity || 0), 3)} ${l.unit}`}
            />
          ))}
        <Field
          label={mode === "void" || mode === "return" ? "退款账户" : "收款账户"}
          required={["pay", "refund"].includes(mode)}
        >
          {(p) => (
            <Select
              {...p}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">请选择账户（没有退款时可留空）</option>
              {accounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField
          label="业务日期"
          value={date}
          onChange={setDate}
          type="date"
          required
        />
        <TextField
          label="操作原因"
          value={reason}
          onChange={setReason}
          required
        />
        <p className="muted">
          {mode === "void"
            ? "作废将冲回尚未退回的库存，并登记净实收退款。"
            : mode === "return"
              ? "退货会增加库存并减少应收；需要退款时同步记账。"
              : "收退款写入账户明细，更正通过冲销原流水完成。"}
          系统只记录账目，请确认实际收付款。
        </p>
        {action.error && <Notice>{action.error}</Notice>}
        <Submit busy={action.busy}>{title}</Submit>
      </Form>
    </Modal>
  );
}

function Detail({
  sale,
  user,
  catalog,
  onChange,
  onEdit,
  onClose,
}: {
  sale: Sale;
  user: User;
  catalog: CatalogEntry[];
  onChange: (sale: Sale) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [print, setPrint] = useState(
    new URLSearchParams(location.search).get("sale_print") === sale.id,
  );
  const [operation, setOperation] = useState("");
  const [snapshot, setSnapshot] = useState<{
    before: Sale | null;
    after: Sale;
    actor_name: string;
  }>();
  const action = useAction();
  const refresh = async () => onChange(await api<Sale>(`/sales/${sale.id}`));
  const upload = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    await api(`/sales/${sale.id}/attachments`, { method: "POST", body });
    await refresh();
  };
  return (
    <section className="panel sale-detail">
      <div className="section-title">
        <div>
          <h2>
            {sale.type_name} · {sale.number}
          </h2>
          <p>
            {saleStatus(sale)} · V{sale.version}
          </p>
        </div>
        <Button className="button" onClick={onClose}>
          返回列表
        </Button>
      </div>
      <div className="sale-detail-meta">
        <p>
          客户：{sale.customer.name} · {sale.customer.data.contact} ·{" "}
          {sale.customer.data.phone}
          <br />
          地址：{sale.customer.data.address || "—"}
        </p>
        <p>
          日期：{sale.business_date} · 开单人：{sale.actor_name}
        </p>
      </div>
      <div className="form-actions">
        <Button className="button" onClick={() => setPrint(true)}>
          <Printer size={17} />
          打印预览
        </Button>
        {sale.status !== "voided" &&
          (user.role === "admin" || sale.status === "draft") && (
            <Button className="button" onClick={onEdit}>
              {sale.status === "draft" ? "编辑草稿" : "修订单据"}
            </Button>
          )}
        {user.role === "admin" && sale.status === "posted" && (
          <>
            {sale.billable &&
              ["pay", "refund", "correct"].map((mode) => (
                <Button
                  key={mode}
                  className="button"
                  onClick={() => setOperation(mode)}
                >
                  {
                    (
                      {
                        pay: "登记收款",
                        refund: "登记退款",
                        correct: "更正流水",
                      } as Record<string, string>
                    )[mode]
                  }
                </Button>
              ))}
            <Button className="button" onClick={() => setOperation("return")}>
              办理退货
            </Button>
            <Button
              className="button danger"
              onClick={() => setOperation("void")}
            >
              作废单据
            </Button>
          </>
        )}
      </div>
      <div className="sale-detail-lines">
        {sale.lines.map((l) => (
          <div key={l.item_id}>
            <strong>{l.name}</strong>
            <span>
              {l.spec} · {decimalText(l.quantity, 3)} {l.unit}
            </span>
            {sale.billable && (
              <span>
                单价 ¥{decimalText(l.price, 4)} · 金额 ¥{moneyText(l.amount)}
              </span>
            )}
            {sale.returned[l.item_id] && (
              <small>
                已退 {decimalText(sale.returned[l.item_id].quantity, 3)}{" "}
                {l.unit}
              </small>
            )}
          </div>
        ))}
      </div>
      {sale.billable && (
        <div className="sale-amounts">
          <span>原金额：¥{moneyText(sale.subtotal)}</span>
          <span>优惠：¥{moneyText(sale.discount + sale.rounding)}</span>
          <strong>当前应收：¥{moneyText(sale.due)}</strong>
          <span>净实收：¥{moneyText(sale.paid)}</span>
          <strong>剩余欠款：¥{moneyText(sale.debt)}</strong>
        </div>
      )}
      <p>
        业绩归属：{sale.department_name || "未指定"} →{" "}
        {sale.salesperson_name || "未指定"}
      </p>
      <p>备注：{sale.note || "—"}</p>
      <h3>收退款记录</h3>
      {!sale.payments.length && <p className="muted">暂无收退款。</p>}
      {sale.payments.map((p) => (
        <p key={p.id}>
          {p.business_date} · {p.account_name} · ¥{moneyText(p.amount)} ·{" "}
          {p.actor_name} · {p.note}
          {p.reversal_of && "（冲销）"}
        </p>
      ))}
      {sale.returns.length > 0 && (
        <>
          <h3>退货记录</h3>
          {sale.returns.map((r) => (
            <p key={r.id}>
              {r.business_date} · {r.actor_name} · 应收减少 ¥
              {moneyText(r.credit)} · {r.reason}
            </p>
          ))}
        </>
      )}
      <h3>签字及凭证照片</h3>
      <div className="sale-attachments">
        {sale.attachments.map((a) => (
          <div key={a.id}>
            <a
              href={`/api/sales/attachments/${a.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`/api/sales/attachments/${a.id}`}
                alt={`签字凭证，上传人 ${a.actor_name}`}
              />
            </a>
            {!a.active && <small>已移除 · 历史凭证</small>}
            {user.role === "admin" && a.active && (
              <Button
                className="button"
                onClick={() =>
                  action.run(async () => {
                    await api(`/sales/attachments/${a.id}`, {
                      method: "DELETE",
                    });
                    await refresh();
                  })
                }
              >
                移除凭证
              </Button>
            )}
          </div>
        ))}
      </div>
      {sale.status !== "voided" &&
        sale.attachments.filter((a) => a.active).length < 2 && (
          <Field
            label="上传凭证照片"
            hint="最多两张，每张 10 MB，支持 JPEG、PNG、WebP。手机可选择拍照。"
          >
            {(p) => (
              <label className="file-picker" htmlFor={p.id}>
                <span className="button">选择照片</span>
                <span className="file-picker-name" role="status">
                  {action.busy ? "正在上传…" : "拍照或选择照片"}
                </span>
                <Input
                  {...p}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={action.busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void action.run(() => upload(file));
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </Field>
        )}
      <h3>修改记录</h3>
      {sale.revisions.map((r) => (
        <div className="sale-revision" key={r.version}>
          <span>
            V{r.version} · {r.actor_name} · {dateTime(r.created_at)} ·{" "}
            {r.reason || "新建 / 保存"}
          </span>
          {user.role === "admin" && (
            <Button
              className="button small"
              onClick={() =>
                action.run(async () =>
                  setSnapshot(
                    await api<{
                      before: Sale | null;
                      after: Sale;
                      actor_name: string;
                    }>(`/sales/${sale.id}/revisions/${r.version}`),
                  ),
                )
              }
            >
              查看前后记录
            </Button>
          )}
        </div>
      ))}
      {action.error && <Notice>{action.error}</Notice>}
      {operation && (
        <Operation
          mode={operation}
          sale={sale}
          catalog={catalog}
          onClose={() => setOperation("")}
          onDone={(s) => {
            onChange(s);
            setOperation("");
          }}
        />
      )}
      {print && (
        <SalesPrint
          sale={sale}
          company={catalog.find((c) => c.kind === "company")}
          onClose={() => setPrint(false)}
        />
      )}
      {snapshot !== undefined && (
        <Modal title="单据修改前后记录" onClose={() => setSnapshot(undefined)}>
          <p>经办人：{snapshot.actor_name}</p>
          <TableScroll>
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>修改前</th>
                  <th>修改后</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["客户", (s: Sale) => s.customer.name],
                    ["业绩部门", (s: Sale) => s.department_name || "未指定"],
                    ["部门业务员", (s: Sale) => s.salesperson_name || "未指定"],
                    ["单据类型", (s: Sale) => s.type_name],
                    ["状态", (s: Sale) => saleStatus(s)],
                    ["业务日期", (s: Sale) => s.business_date],
                    ["应收", (s: Sale) => `¥${moneyText(s.due)}`],
                    ["净实收", (s: Sale) => `¥${moneyText(s.paid)}`],
                    ["欠款", (s: Sale) => `¥${moneyText(s.debt)}`],
                    ["备注", (s: Sale) => s.note || "—"],
                  ] as [string, (s: Sale) => string][]
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{snapshot.before ? value(snapshot.before) : "—"}</td>
                    <td>{value(snapshot.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <h3>物料明细</h3>
          {[
            ...new Set(
              [...(snapshot.before?.lines || []), ...snapshot.after.lines].map(
                (l) => l.item_id,
              ),
            ),
          ].map((id) => {
            const before = snapshot.before?.lines.find((l) => l.item_id === id);
            const after = snapshot.after.lines.find((l) => l.item_id === id);
            return (
              <p key={id}>
                <strong>{after?.name || before?.name}</strong>
                <br />
                数量：{before ? decimalText(before.quantity, 3) : "—"} →{" "}
                {after ? decimalText(after.quantity, 3) : "—"}
                <br />
                单价：{before ? decimalText(before.price, 4) : "—"} →{" "}
                {after ? decimalText(after.price, 4) : "—"}
              </p>
            );
          })}
        </Modal>
      )}
    </section>
  );
}

function FinancePanel({
  revision,
  onSelect,
}: {
  revision: number;
  onSelect: (id: string) => void;
}) {
  const resource = useResource<Finance>("/sales/finance", revision);
  const [account, setAccount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const data = resource.data;
  if (resource.error) return <Notice>{resource.error}</Notice>;
  if (!data) return <Loading />;
  const entries = data.entries.filter(
    (e) =>
      (!account || e.account_id === account) &&
      (!start || e.business_date >= start) &&
      (!end || e.business_date <= end),
  );
  const total = entries.reduce((a, e) => a + e.amount, 0);
  const download = () => {
    const rows = [
      ["单号", "日期", "账户", "金额（元）", "经办人", "备注"],
      ...entries.map((e) => [
        e.number,
        e.business_date,
        e.account_name,
        (e.amount / 100).toFixed(2),
        e.actor_name,
        e.note,
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map(
              (x, column) =>
                '"' +
                (column !== 3 && /^[=+\-@\t\r]/.test(x) ? "'" : "") +
                x.replace(/"/g, '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "销售收款对账.csv";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel">
      <h2>收款与欠款</h2>
      <div className="sale-amounts">
        <span>应收：¥{moneyText(data.due)}</span>
        <span>净实收：¥{moneyText(data.paid)}</span>
        <strong>客户欠款：¥{moneyText(data.debt)}</strong>
      </div>
      <h3>部门与业务员业绩</h3>
      <p className="muted">
        按有效计款单据统计，业绩金额扣除退货，作废单不计入。实收为净收款。
      </p>
      <TableScroll>
        <table aria-label="业绩归属汇总">
          <thead>
            <tr>
              <th>部门</th>
              <th>业务员</th>
              <th>单数</th>
              <th>业绩金额</th>
              <th>净实收</th>
              <th>欠款</th>
            </tr>
          </thead>
          <tbody>
            {data.performance.map((p) => (
              <tr key={`${p.department_id}:${p.salesperson_id}`}>
                <td>{p.department_name || "未指定"}</td>
                <td>{p.salesperson_name || "未指定"}</td>
                <td>{p.count}</td>
                <td>¥{moneyText(p.due)}</td>
                <td>¥{moneyText(p.paid)}</td>
                <td>¥{moneyText(p.debt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <h3>客户对账（全部有效单据）</h3>
      <div className="sale-detail-lines">
        {data.customers.map((c) => (
          <div key={c.id}>
            <strong>{c.name}</strong>
            <span>
              应收 ¥{moneyText(c.due)} · 净实收 ¥{moneyText(c.paid)} · 欠款 ¥
              {moneyText(c.debt)}
            </span>
          </div>
        ))}
      </div>
      <h3>账户收退款流水</h3>
      <div className="form-grid">
        <Field label="筛选账户">
          {(p) => (
            <Select
              {...p}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">全部账户</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField
          label="开始日期"
          type="date"
          value={start}
          onChange={setStart}
        />
        <TextField label="结束日期" type="date" value={end} onChange={setEnd} />
      </div>
      <div className="form-actions">
        <strong>筛选净收款：¥{moneyText(total)}</strong>
        <Button className="button" onClick={download}>
          导出对账 CSV
        </Button>
      </div>
      <TableScroll>
        <table>
          <thead>
            <tr>
              <th>单号</th>
              <th>日期</th>
              <th>账户</th>
              <th>收款 / 退款</th>
              <th>经办人</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <Button
                    className="text-button"
                    onClick={() => onSelect(e.sale_id)}
                  >
                    {e.number}
                  </Button>
                </td>
                <td>{e.business_date}</td>
                <td>{e.account_name}</td>
                <td>¥{moneyText(e.amount)}</td>
                <td>{e.actor_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}

export default function Sales({
  user,
  revision,
  refresh,
  onDirtyChange,
}: {
  user: User;
  revision: number;
  refresh: () => void;
  onDirtyChange: (v: boolean) => void;
}) {
  const [tab, setTab] = useState("list");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Sale>();
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<{
    kind: CatalogEntry["kind"];
    entry?: CatalogEntry;
  }>();
  const [local, setLocal] = useState(0);
  const action = useAction();
  const catalog = useResource<{ items: CatalogEntry[] }>(
    "/sales/catalog",
    revision + local,
  );
  const list = useResource<{ items: Sale[] }>(
    `/sales?q=${encodeURIComponent(query)}&page=${page}`,
    revision + local,
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  const entries = catalog.data?.items || [];
  const changed = (sale: Sale) => {
    setSelected(sale);
    setLocal((n) => n + 1);
    refresh();
  };
  const select = (id: string) =>
    action.run(async () => {
      setSelected(await api<Sale>(`/sales/${id}`));
      setTab("list");
    });
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("sale_print");
    if (id) void select(id);
  }, []);
  useEffect(() => {
    if (selected && !editing)
      void api<Sale>(`/sales/${selected.id}`)
        .then(setSelected)
        .catch(() => {});
  }, [revision]);
  const confirm = useConfirm();
  const closeEditor = async () => {
    if (
      editing &&
      (await confirm({
        title: "离开开单页面？",
        description: "未保存的修改会丢失。",
        confirmLabel: "确认离开",
      }))
    ) {
      onDirtyChange(false);
      setEditing(false);
    }
  };
  const [configKind, setConfigKind] = useState<CatalogEntry["kind"]>("type");
  return (
    <div className="sales-page">
      <div className="page-heading">
        <div>
          <h1>开单与收款</h1>
          <p>一张单开齐物料，库存与收款同步记录。</p>
        </div>
        {!editing && (
          <Button
            className="button primary"
            onClick={() => {
              setSelected(undefined);
              setEditing(true);
              setTab("list");
            }}
          >
            <Plus size={18} />
            新建单据
          </Button>
        )}
      </div>
      {!editing && (
        <div className="sale-tabs">
          <Button
            className={`button ${tab === "list" ? "primary" : ""}`}
            onClick={() => {
              setTab("list");
              setSelected(undefined);
            }}
          >
            单据列表
          </Button>
          {user.role === "admin" && (
            <Button
              className={`button ${tab === "finance" ? "primary" : ""}`}
              onClick={() => {
                setTab("finance");
                setSelected(undefined);
              }}
            >
              收款与欠款
            </Button>
          )}
          <Button
            className={`button ${tab === "config" ? "primary" : ""}`}
            onClick={() => {
              setTab("config");
              setSelected(undefined);
            }}
          >
            客户与配置
          </Button>
        </div>
      )}
      {(catalog.error || action.error) && (
        <Notice>{catalog.error || action.error}</Notice>
      )}
      {editing ? (
        <SaleEditor
          key={selected?.id || "new"}
          sale={selected}
          user={user}
          catalog={entries}
          onDirtyChange={onDirtyChange}
          onNewCustomer={() => setConfig({ kind: "customer" })}
          onClose={() => void closeEditor()}
          onDone={(s) => {
            changed(s);
            setEditing(false);
          }}
        />
      ) : selected ? (
        <Detail
          sale={selected}
          user={user}
          catalog={entries}
          onEdit={() => setEditing(true)}
          onChange={changed}
          onClose={() => setSelected(undefined)}
        />
      ) : tab === "list" ? (
        <section className="panel">
          <label className="search">
            <Search size={18} />
            <Input
              aria-label="搜索销售单"
              placeholder="客户、单号或物料名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {list.error && <Notice>{list.error}</Notice>}
          {list.loading && <Loading />}
          <div className="sale-list">
            {list.data?.items.map((s) => (
              <Button
                key={s.id}
                className="sale-list-item"
                onClick={() => void select(s.id)}
              >
                <span>
                  <strong>
                    {s.type_name} · {s.customer.name}
                  </strong>
                  <small>
                    {s.number} · {s.business_date} · {s.actor_name}
                  </small>
                  <small>
                    {s.department_name || "未指定"} →{" "}
                    {s.salesperson_name || "未指定"}
                  </small>
                  <small>{saleStatus(s)}</small>
                </span>
                <span>
                  {s.lines.length} 种物料
                  {s.billable && (
                    <>
                      <strong>¥{moneyText(s.total)}</strong>
                      <small>欠款 ¥{moneyText(s.debt)}</small>
                    </>
                  )}
                </span>
              </Button>
            ))}
          </div>
          {list.data && !list.data.items.length && (
            <Empty>暂无单据，点击新建单据开始。</Empty>
          )}
          <div className="form-actions">
            <Button
              className="button"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              上一页
            </Button>
            <span>第 {page} 页</span>
            <Button
              className="button"
              disabled={(list.data?.items.length || 0) < 50}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
      ) : tab === "finance" && user.role === "admin" ? (
        <FinancePanel
          revision={revision + local}
          onSelect={(id) => void select(id)}
        />
      ) : (
        <section className="panel">
          <div className="form-actions">
            {(user.role === "admin"
              ? [
                  "customer",
                  "type",
                  "account",
                  "department",
                  "salesperson",
                  "company",
                ]
              : ["customer"]
            ).map((k) => (
              <Button
                key={k}
                className={`button ${configKind === k ? "primary" : ""}`}
                onClick={() => setConfigKind(k as CatalogEntry["kind"])}
              >
                {
                  (
                    {
                      customer: "客户",
                      type: "单据类型",
                      account: "收款账户",
                      company: "公司信息",
                      department: "部门",
                      salesperson: "业务员",
                    } as Record<string, string>
                  )[k]
                }
              </Button>
            ))}
          </div>
          <div className="form-actions">
            <h2>
              {
                {
                  customer: "客户",
                  type: "单据类型",
                  account: "收款账户",
                  company: "公司信息",
                  department: "部门",
                  salesperson: "业务员",
                }[configKind]
              }
            </h2>
            <Button
              className="button"
              onClick={() =>
                setConfig({
                  kind: configKind,
                  entry:
                    configKind === "company"
                      ? entries.find((c) => c.kind === "company")
                      : undefined,
                })
              }
            >
              新增 / 设置
            </Button>
          </div>
          {entries
            .filter((c) => c.kind === configKind)
            .map((c) => (
              <div className="sale-revision" key={c.id}>
                <span>
                  <strong>{c.name}</strong> · {c.active ? "启用" : "停用"}
                  {c.kind === "type"
                    ? c.data.billable
                      ? " · 计款"
                      : " · 不计款"
                    : ""}{" "}
                  {c.kind === "salesperson" &&
                    ` · ${entries.find((d) => d.id === c.data.department_id)?.name || "未指定部门"}`}
                  {c.data.phone} {c.data.address}
                </span>
                {user.role === "admin" && (
                  <Button
                    className="button"
                    onClick={() => setConfig({ kind: c.kind, entry: c })}
                  >
                    修改
                  </Button>
                )}
              </div>
            ))}
        </section>
      )}
      {config && (
        <ConfigForm
          catalog={entries}
          kind={config.kind}
          entry={config.entry}
          onClose={() => setConfig(undefined)}
          onDone={() => {
            setConfig(undefined);
            setLocal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
