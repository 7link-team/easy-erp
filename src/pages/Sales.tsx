import { useQueryValue } from "../navigation";
import { can } from "../api";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Plus, Search, Printer, ArrowLeft, Trash2, Pencil } from "lucide-react";
import {
  Button,
  Tabs,
  TabsList,
  Tab,
  TabsPanel,
  Input,
  Select,
  ComboBox,
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
import { useDictionaryOrder } from "../DictionaryOrder";
import TableImport from "../TableImport";
import MaterialOptions, { type MaterialOption } from "./MaterialOptions";
import { api, send, quantity, dateTime, type User, type Item } from "../api";
import {
  moneyText,
  correctablePayments,
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
import ItemPicker from "../ItemPicker";

function TextField({
  label,
  value,
  onChange,
  required = false,
  decimal = false,
  type = "text",
  hint,
  error,
  inputLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  decimal?: boolean;
  type?: string;
  hint?: string;
  error?: string;
  inputLabel?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      {(p) => (
        <Input
          {...p}
          aria-label={inputLabel}
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
type CreatableCatalogKind =
  "customer" | "department" | "salesperson" | "account";
const catalogLabels: Record<CreatableCatalogKind, string> = {
  customer: "客户",
  department: "部门",
  salesperson: "业务员",
  account: "收款账户",
};
function CatalogSelect({
  user,
  kind,
  catalog,
  onCreated,
  canCreate,
  departmentId,
  ...props
}: ComponentProps<typeof Select> & {
  user: User;
  kind: CreatableCatalogKind;
  catalog: CatalogEntry[];
  onCreated: (entry: CatalogEntry) => void;
  canCreate?: boolean;
  departmentId?: string;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select
        {...props}
        createLabel={`新增${catalogLabels[kind]}`}
        onCreate={
          (canCreate ??
          can(
            user,
            `${kind === "customer" ? "customers" : kind === "account" ? "accounts" : "catalog"}.create`,
          ))
            ? () => setCreating(true)
            : undefined
        }
      />
      {creating && (
        <ConfigForm
          user={user}
          kind={kind}
          catalog={catalog}
          initialDepartment={departmentId}
          onCatalogCreated={onCreated}
          onClose={() => setCreating(false)}
          onDone={(entry) => {
            onCreated(entry);
            props.onChange?.({ target: { value: entry.id } });
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function ConfigForm({
  user,
  kind,
  entry,
  onDone,
  onClose,
  catalog,
  initialDepartment,
  onCatalogCreated,
}: {
  catalog: CatalogEntry[];
  initialDepartment?: string;
  onCatalogCreated: (entry: CatalogEntry) => void;
  user: User;
  kind: CatalogEntry["kind"];
  entry?: CatalogEntry;
  onDone: (entry: CatalogEntry) => void;
  onClose: () => void;
}) {
  const [department, setDepartment] = useState(
    entry?.data.department_id || initialDepartment || "",
  );
  const [name, setName] = useState(entry?.name || "");
  const [phone, setPhone] = useState(entry?.data.phone || "");
  const [contact, setContact] = useState(entry?.data.contact || "");
  const [address, setAddress] = useState(entry?.data.address || "");
  const [accountType, setAccountType] = useState(
    entry?.data.account_type || "",
  );
  const [billable, setBillable] = useState(entry?.data.billable ?? true);
  const [active, setActive] = useState(entry?.active ?? true);
  const [sort, setSort] = useState(String(entry?.data.sort ?? 0));
  const [note, setNote] = useState(entry?.data.note || "");
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
              const saved = await send<CatalogEntry>("/sales/catalog", {
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
                  account_type: accountType,
                  note,
                },
              });
              onDone(saved);
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
              <CatalogSelect
                user={user}
                {...p}
                kind="department"
                catalog={catalog}
                onCreated={onCatalogCreated}
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
              </CatalogSelect>
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
        {kind === "department" && (
          <TextField label="负责人" value={contact} onChange={setContact} />
        )}
        {kind === "account" && (
          <Field label="账户类型">
            {(p) => (
              <Input
                {...p}
                name="account-type"
                autoComplete="off"
                maxLength={30}
                placeholder="例如银行、现金、微信…"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              />
            )}
          </Field>
        )}
        {kind === "type" && (
          <>
            <label className="checkbox">
              <Checkbox
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
              />
              计款（产生应收与欠款）
            </label>
            <p className="muted">
              所有类型确认后都会扣库存。名称仅用于区分单据。
            </p>
          </>
        )}
        <TextField label="说明" value={note} onChange={setNote} />
        <TextField
          label="排列顺序"
          value={sort}
          onChange={setSort}
          decimal
          hint="0–9999，数字较小的排在前面"
        />
        {kind !== "company" && (
          <label className="checkbox">
            <Checkbox
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            启用
          </label>
        )}
        {action.error && <Notice>{action.error}</Notice>}
        <div className="form-actions form-footer">
          <Button onClick={onClose}>取消</Button>
          <Submit busy={action.busy}>保存配置</Submit>
        </div>
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
  onCatalogCreated,
  initialItem,
}: {
  user: User;
  sale?: Sale;
  catalog: CatalogEntry[];
  onDone: (sale: Sale) => void;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onCatalogCreated: (entry: CatalogEntry) => void;
  initialItem?: Item;
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
      })) ||
      (initialItem
        ? [{ item_id: initialItem.id, quantity: "1", price: "0" }]
        : []),
  };
  const [input, setInput] = useState(initial);
  const [settlement, setSettlement] = useState(
    sale?.initial_payment
      ? Math.round(Number(sale.initial_payment.amount) * 100) === sale.total
        ? "full"
        : "partial"
      : "unpaid",
  );
  const [receiptAmount, setReceiptAmount] = useState(
    sale?.initial_payment?.amount || "",
  );
  const [receiptAccount, setReceiptAccount] = useState(
    sale?.initial_payment?.account_id || "",
  );
  const settlementFields = useRef<HTMLDivElement>(null);
  const [pendingLine, setPendingLine] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItemId, setPickerItemId] = useState<string>();
  const firstAdded = useRef<string | null>(null);
  const lineElements = useRef<HTMLDivElement>(null);
  const openPicker = () => {
    firstAdded.current = null;
    setPickerItemId(undefined);
    setPendingLine(true);
    setChanged(true);
    setPickerOpen(true);
  };
  const [reason, setReason] = useState("");
  const [account, setAccount] = useState("");
  const [refundDate, setRefundDate] = useState(localDate());
  const action = useAction();
  const [material, setMaterial] = useState<Record<string, Item>>(
    initialItem ? { [initialItem.id]: initialItem } : {},
  );
  const [stockLoadError, setStockLoadError] = useState("");
  useEffect(() => {
    if (!sale?.lines.length) return;
    const controller = new AbortController();
    const batches: Promise<{ items: Item[] }>[] = [];
    for (let offset = 0; offset < sale.lines.length; offset += 50) {
      const ids = sale.lines
        .slice(offset, offset + 50)
        .map((line) => line.item_id)
        .join(",");
      batches.push(
        api(`/items?ids=${encodeURIComponent(ids)}`, {
          signal: controller.signal,
        }),
      );
    }
    void Promise.all(batches)
      .then((pages) => {
        if (!controller.signal.aborted)
          setMaterial((current) => ({
            ...current,
            ...Object.fromEntries(
              pages
                .flatMap((page) => page.items)
                .map((item) => [item.id, item]),
            ),
          }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStockLoadError(
            "未能读取全部明细的当前库存，请重新打开单据后重试。",
          );
      });
    return () => controller.abort();
  }, [sale?.id]);
  const [changed, setChanged] = useState(!!initialItem);
  const request = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
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
      : (typ?.data.billable ?? input.type_billable ?? false);
  const amounts = preview(input, billable);
  const posted = sale?.status === "posted";
  const collecting = billable && !posted && settlement !== "unpaid";
  const receipt = collecting
    ? settlement === "full"
      ? amounts?.total
      : /^\d+(\.\d{1,2}0*)?$/.test(receiptAmount.trim()) &&
          receiptAmount.trim().length <= 24
        ? Math.round(Number(receiptAmount) * 100)
        : undefined
    : 0;
  const receiptError = collecting
    ? receipt === undefined || !Number.isSafeInteger(receipt) || receipt <= 0
      ? "请输入大于 0 的收款金额，最多 2 位小数。"
      : amounts && receipt > amounts.total
        ? "本次收款不能超过应收金额。"
        : undefined
    : undefined;
  const options = (kind: CatalogEntry["kind"], selected: string) =>
    catalog.filter((c) => c.kind === kind && (c.active || c.id === selected));
  const stockError = (line: SaleInput["lines"][number]) => {
    const item = material[line.item_id];
    if (!item || !/^\d+(\.\d{0,3})?$/.test(line.quantity.trim()))
      return undefined;
    // A posted revision only deducts the increase over the original quantity.
    const original = posted
      ? sale.lines.find((prior) => prior.item_id === line.item_id)?.quantity ||
        0
      : 0;
    const available = item.balance + original;
    const excess = Math.round(Number(line.quantity) * 1000) - available;
    return excess > 0
      ? `超出${posted ? "可开数量" : "库存"} ${quantity(excess, item.precision)} ${item.unit}，${posted ? "本次最多可开" : "当前库存"} ${quantity(available, item.precision)} ${item.unit}。`
      : undefined;
  };
  async function save(actionName: string) {
    if (pendingLine) throw new Error("请先选择新增行的物料，或移除空行。");
    if (collecting && (receiptError || !receiptAccount)) {
      settlementFields.current
        ?.querySelector<HTMLElement>(
          receiptError
            ? '.form-grid input:not([type="hidden"])'
            : '.form-grid [role="combobox"]',
        )
        ?.focus();
      throw new Error(receiptError || "请选择本次收款账户。");
    }
    if (actionName !== "save") {
      const invalid = input.lines.find((line) => stockError(line));
      if (invalid) {
        lineElements.current
          ?.querySelector<HTMLInputElement>(
            `[data-item-id="${CSS.escape(invalid.item_id)}"] input`,
          )
          ?.focus();
        throw new Error(
          "物料数量超出可用库存，请先调整标红的数量；也可保存草稿。",
        );
      }
    }
    const payload = {
      sale_id: sale?.id || "",
      version: sale?.version || 0,
      action: actionName,
      input: {
        ...input,
        initial_payment: collecting
          ? { account_id: receiptAccount, amount: decimalText(receipt!, 2) }
          : null,
      },
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
  const materialPicker = (
    p: { id: string; "aria-describedby"?: string },
    itemId?: string,
    name?: string,
  ) => (
    <ItemPicker
      id={p.id}
      describedBy={p["aria-describedby"]}
      name={name}
      open={pickerOpen && pickerItemId === itemId}
      onOpenChange={(open) => {
        if (open) {
          firstAdded.current = null;
          setPickerItemId(itemId);
        }
        setPickerOpen(open);
      }}
      selectedIds={input.lines.map((line) => line.item_id)}
      searchLabel="开单查找物料"
      onSelect={(item) => {
        firstAdded.current = item.id;
        setMaterial((current) => ({ ...current, [item.id]: item }));
        const line = { item_id: item.id, quantity: "1", price: "" };
        change(
          "lines",
          itemId
            ? input.lines.map((current) =>
                current.item_id === itemId ? line : current,
              )
            : [...input.lines, line],
        );
        setPickerOpen(false);
        if (!itemId) setPendingLine(false);
      }}
      onCloseAutoFocus={(event) => {
        if (firstAdded.current) {
          const target = lineElements.current?.querySelector<HTMLInputElement>(
            `[data-item-id="${CSS.escape(firstAdded.current)}"] input`,
          );
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }
      }}
    />
  );
  return (
    <section className="panel sale-editor document-editor">
      <div className="section-title">
        <h1>{sale ? (posted ? "修订单据" : "编辑草稿") : "新建单据"}</h1>
        <Button className="button" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回单据
        </Button>
      </div>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(() =>
              save(
                posted
                  ? "revise"
                  : can(user, "sales.confirm")
                    ? "confirm"
                    : "save",
              ),
            ),
          )
        }
      >
        <div className="sale-editor-fields document-fields">
          <section
            className="document-section"
            aria-labelledby="sale-basics-heading"
          >
            <div className="document-section-heading">
              <h2 id="sale-basics-heading">
                <span aria-hidden="true">01</span>基本信息
              </h2>
            </div>
            <div className="form-grid">
              <Field label="单据类型" required>
                {(p) => (
                  <ComboBox
                    {...p}
                    required
                    maxLength={100}
                    value={input.type_name || input.type_id}
                    options={options("type", input.type_id).map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                    onValueChange={(value) => {
                      const entry = options("type", input.type_id).find(
                        (c) =>
                          c.id === value ||
                          c.name.trim().toLowerCase() ===
                            value.trim().toLowerCase(),
                      );
                      change("type_id", entry?.id || "");
                      change("type_name", entry ? "" : value);
                      if (!entry?.data.billable) {
                        change("discount_rate", "100");
                        change("rounding", "0");
                      }
                    }}
                  />
                )}
              </Field>
              {input.type_name && (
                <Field
                  label="新类型是否计款"
                  required
                  hint="计款会产生应收；不计款只记录出库。"
                >
                  {(p) => (
                    <Select
                      {...p}
                      required
                      value={
                        input.type_billable === undefined
                          ? ""
                          : String(input.type_billable)
                      }
                      onChange={(e) =>
                        change("type_billable", e.target.value === "true")
                      }
                    >
                      <option value="">请选择</option>
                      <option value="true">计款</option>
                      <option value="false">不计款</option>
                    </Select>
                  )}
                </Field>
              )}
              <Field label="客户" required>
                {(p) => (
                  <CatalogSelect
                    user={user}
                    {...p}
                    kind="customer"
                    catalog={catalog}
                    onCreated={onCatalogCreated}
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
                  </CatalogSelect>
                )}
              </Field>
              <Field
                label="业绩部门"
                hint="先选部门，再选该部门业务员。与开单人分别记录。"
              >
                {(p) => (
                  <CatalogSelect
                    user={user}
                    {...p}
                    kind="department"
                    catalog={catalog}
                    onCreated={onCatalogCreated}
                    canCreate={can(user, "catalog.create")}
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
                    {options("department", input.department_id || "").map(
                      (c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ),
                    )}
                  </CatalogSelect>
                )}
              </Field>
              <Field label="部门业务员" required={!!input.department_id}>
                {(p) => (
                  <CatalogSelect
                    user={user}
                    {...p}
                    kind="salesperson"
                    catalog={catalog}
                    onCreated={(entry) => {
                      onCatalogCreated(entry);
                      if (entry.kind === "salesperson")
                        change("department_id", entry.data.department_id || "");
                    }}
                    canCreate={can(user, "catalog.create")}
                    departmentId={input.department_id}
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
                  </CatalogSelect>
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
          </section>
          <section
            className="document-section document-material-section"
            aria-labelledby="sale-lines-heading"
          >
            <div className="document-section-heading">
              <h2 id="sale-lines-heading">
                <span aria-hidden="true">02</span>物料明细
              </h2>
              <span role="status">已添加 {input.lines.length} 种</span>
            </div>
            {stockLoadError && <Notice>{stockLoadError}</Notice>}
            {!input.lines.length && (
              <Empty>点击“添加一行”，选择物料后填写数量和单价。</Empty>
            )}
            <div className="sale-lines document-lines" ref={lineElements}>
              {input.lines.map((l, i) => {
                const item = material[l.item_id];
                const prior = sale?.lines.find((x) => x.item_id === l.item_id);
                const name = item?.name || prior?.name || l.item_id;
                return (
                  <div
                    className="sale-line document-line"
                    key={l.item_id}
                    data-item-id={l.item_id}
                  >
                    <div className="sale-line-title">
                      <Field label="物料" required>
                        {(p) => materialPicker(p, l.item_id, name)}
                      </Field>
                      <small>
                        {item?.spec || prior?.spec} ·{" "}
                        {item?.unit || prior?.unit}
                      </small>
                      {item && (
                        <small>
                          当前库存：{quantity(item.balance, item.precision)}
                          {item.unit}
                        </small>
                      )}
                    </div>
                    <TextField
                      label="数量"
                      inputLabel={`${name} 数量`}
                      error={stockError(l)}
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
                      <TextField
                        label="单价"
                        inputLabel={`${name} 单价`}
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
                    )}
                    <div className="sale-line-actions">
                      {billable && (
                        <div className="sale-line-amount">
                          金额：
                          {amounts
                            ? `¥${moneyText(amounts.amounts[i])}`
                            : "待填写"}
                        </div>
                      )}
                      <Button
                        className="button small sale-line-delete"
                        aria-label={`移除${name}`}
                        onClick={() =>
                          change(
                            "lines",
                            input.lines.filter((_, j) => i !== j),
                          )
                        }
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
              {pendingLine && (
                <div className="sale-line document-line sale-line-pending">
                  <div className="sale-line-title">
                    <Field label="物料" required>
                      {(p) => materialPicker(p)}
                    </Field>
                  </div>
                  <Field label="数量" required>
                    {(p) => <Input {...p} disabled placeholder="先选择物料…" />}
                  </Field>
                  {billable && (
                    <Field label="单价" required>
                      {(p) => (
                        <Input {...p} disabled placeholder="先选择物料…" />
                      )}
                    </Field>
                  )}
                  <div className="sale-line-actions">
                    {" "}
                    <Button
                      className="button small sale-line-delete"
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
                  onClick={openPicker}
                >
                  <Plus size={16} aria-hidden="true" />
                  添加一行
                </Button>
              )}
            </div>
          </section>
          {billable && (
            <section
              className="document-section"
              aria-labelledby="sale-totals-heading"
            >
              <div className="document-section-heading">
                <h2 id="sale-totals-heading">
                  <span aria-hidden="true">03</span>金额结算
                </h2>
              </div>
              <div className="form-grid">
                {can(user, "sales.discount") ? (
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
                  <p className="muted">当前账号没有优惠权限。</p>
                )}
              </div>
              <div className="sale-amounts">
                <span>
                  原金额：¥{amounts ? moneyText(amounts.subtotal) : "—"}
                </span>
                <span>
                  折扣：¥{amounts ? moneyText(amounts.discount) : "—"}
                </span>
                <span>
                  抹零：¥{amounts ? moneyText(amounts.rounding) : "—"}
                </span>
                <strong>
                  应收：¥{amounts ? moneyText(amounts.total) : "—"}
                </strong>
              </div>
              {!posted && (
                <div className="sale-settlement" ref={settlementFields}>
                  <Field label="结算方式" required>
                    {(p) => (
                      <Select
                        {...p}
                        value={settlement}
                        onChange={(e) => {
                          setChanged(true);
                          setSettlement(e.target.value);
                        }}
                      >
                        <option value="unpaid">全部欠款（暂不收款）</option>
                        <option
                          value="partial"
                          disabled={!can(user, "sales.pay")}
                        >
                          部分收款
                        </option>
                        <option value="full" disabled={!can(user, "sales.pay")}>
                          全额收款
                        </option>
                      </Select>
                    )}
                  </Field>
                  {!can(user, "sales.pay") && (
                    <p className="muted">
                      当前账号没有收款权限，可先开单记欠款，再由有权限的人员登记收款。
                    </p>
                  )}
                  {collecting && (
                    <div className="form-grid">
                      {settlement === "partial" && (
                        <TextField
                          label="本次收款"
                          value={receiptAmount}
                          decimal
                          required
                          hint="元，最多 2 位小数"
                          error={receiptAmount ? receiptError : undefined}
                          onChange={(value) => {
                            setChanged(true);
                            setReceiptAmount(value);
                          }}
                        />
                      )}
                      <Field label="本次收款账户" required>
                        {(p) => (
                          <CatalogSelect
                            {...p}
                            user={user}
                            kind="account"
                            catalog={catalog}
                            onCreated={onCatalogCreated}
                            canCreate={can(user, "accounts.create")}
                            value={receiptAccount}
                            onChange={(e) => {
                              setChanged(true);
                              setReceiptAccount(e.target.value);
                            }}
                          >
                            <option value="">请选择收款账户</option>
                            {options("account", receiptAccount).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </CatalogSelect>
                        )}
                      </Field>
                    </div>
                  )}
                  <div
                    className="sale-amounts"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <span>
                      本次收款：¥
                      {receipt !== undefined && !receiptError
                        ? moneyText(receipt)
                        : "—"}
                    </span>
                    <strong>
                      剩余欠款：¥
                      {amounts && receipt !== undefined && !receiptError
                        ? moneyText(amounts.total - receipt)
                        : "—"}
                    </strong>
                  </div>
                  <p className="muted">
                    {collecting
                      ? "确认开单时登记实际收款，收款日期与业务日期一致；保存草稿仅保留填写内容。"
                      : "确认开单后，应收金额记入客户欠款，可在单据详情或收款页补收。"}
                  </p>
                </div>
              )}
            </section>
          )}
          <section
            className="document-section"
            aria-labelledby="sale-notes-heading"
          >
            <div className="document-section-heading">
              <h2 id="sale-notes-heading">
                <span aria-hidden="true">{billable ? "04" : "03"}</span>
                {posted ? "备注与修订说明" : "补充说明"}
              </h2>
            </div>
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
                        <CatalogSelect
                          user={user}
                          {...p}
                          kind="account"
                          catalog={catalog}
                          onCreated={onCatalogCreated}
                          canCreate={can(user, "accounts.create")}
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                        >
                          <option value="">无退款时可留空</option>
                          {options("account", account).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </CatalogSelect>
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
          </section>
        </div>
        <div className="form-actions form-footer">
          {action.error && <Notice>{action.error}</Notice>}
          <Button onClick={onClose} disabled={action.busy}>
            取消
          </Button>
          {!posted && can(user, "sales.create") && (
            <Button
              className="button"
              disabled={action.busy}
              onClick={() => action.run(() => save("save"))}
            >
              保存草稿
            </Button>
          )}
          {(posted
            ? can(user, "sales.revise")
            : can(user, "sales.confirm")) && (
            <Submit busy={action.busy}>
              {posted ? "保存修订" : "确认开单并扣库存"}
            </Submit>
          )}
        </div>
      </Form>
    </section>
  );
}

function Operation({
  user,
  mode,
  sale,
  catalog,
  onCatalogCreated,
  onDone,
  onClose,
}: {
  user: User;
  mode: string;
  sale: Sale;
  catalog: CatalogEntry[];
  onCatalogCreated: (entry: CatalogEntry) => void;
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
                {correctablePayments(sale).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.business_date} · {p.account_name} ·{" "}
                    {p.amount < 0 ? "退款" : "收款"} ¥
                    {moneyText(Math.abs(p.amount))}
                    {p.note ? ` · ${p.note}` : ""}
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
            <CatalogSelect
              user={user}
              {...p}
              kind="account"
              catalog={catalog}
              onCreated={onCatalogCreated}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">请选择账户（没有退款时可留空）</option>
              {accounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </CatalogSelect>
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
        <div className="form-actions form-footer">
          <Button onClick={onClose}>取消</Button>
          <Submit busy={action.busy}>{title}</Submit>
        </div>
      </Form>
    </Modal>
  );
}

function Detail({
  sale,
  user,
  catalog,
  onCatalogCreated,
  onChange,
  onEdit,
  onClose,
  backLabel = "返回列表",
}: {
  sale: Sale;
  user: User;
  catalog: CatalogEntry[];
  onCatalogCreated: (entry: CatalogEntry) => void;
  onChange: (sale: Sale) => void;
  onEdit: () => void;
  onClose: () => void;
  backLabel?: string;
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
          {backLabel}
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
          (sale.status === "draft"
            ? can(user, "sales.create")
            : can(user, "sales.revise")) && (
            <Button className="button" onClick={onEdit}>
              {sale.status === "draft" ? "编辑草稿" : "修订单据"}
            </Button>
          )}
        {sale.status === "posted" && (
          <>
            {sale.billable &&
              ["pay", "refund", "correct"]
                .filter((mode) => can(user, `sales.${mode}`))
                .map((mode) => (
                  <Button
                    key={mode}
                    className="button"
                    disabled={
                      mode === "correct" && !correctablePayments(sale).length
                    }
                    aria-describedby={
                      mode === "correct" && !correctablePayments(sale).length
                        ? "sale-correction-empty"
                        : undefined
                    }
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
            {can(user, "sales.return") && (
              <Button className="button" onClick={() => setOperation("return")}>
                办理退货
              </Button>
            )}
            {can(user, "sales.void") && (
              <Button
                className="button danger"
                onClick={() => setOperation("void")}
              >
                作废单据
              </Button>
            )}
          </>
        )}
      </div>
      {can(user, "sales.correct") &&
        sale.status === "posted" &&
        sale.billable &&
        !correctablePayments(sale).length && (
          <p className="hint" id="sale-correction-empty">
            暂无可更正流水，请先登记收款。
          </p>
        )}
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
      {sale.status === "posted" && sale.debt > 0 && (
        <p className="muted">
          打印单据已列明剩余欠款。请客户核对并签字后，拍照上传到本单留存，最多两张。
        </p>
      )}
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
            {can(user, "sales.attachment_delete") && a.active && (
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
      {can(user, "sales.upload") &&
        sale.status !== "voided" &&
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
          {can(user, "sales.history") && (
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
          user={user}
          onCatalogCreated={onCatalogCreated}
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

function CustomerLedger({
  user,
  customer,
  revision,
  onSelect,
  onClose,
}: {
  user: User;
  customer: Finance["customers"][number];
  revision: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const resource = useResource<{ items: Sale[]; total: number }>(
    `/sales?customer_id=${encodeURIComponent(customer.id)}&page=${page}`,
    revision,
  );
  return (
    <Modal title={`${customer.name} · 单据对账`} onClose={onClose}>
      <p>
        客户全部有效单据合计：应收 ¥{moneyText(customer.due)} · 净实收 ¥
        {moneyText(customer.paid)} · 欠款 ¥{moneyText(customer.debt)}
      </p>
      {!can(user, "sales.all") && (
        <p className="muted">
          当前角色仅可查看本人开出的单据，下表不包含其他人的单据。
        </p>
      )}
      {resource.error && <Notice>{resource.error}</Notice>}
      {resource.loading && <Loading />}
      {resource.data && !resource.data.items.length && (
        <Empty>暂无可查看的单据。</Empty>
      )}
      <TableScroll>
        <table className="customer-ledger-table" aria-label="客户单据对账">
          <thead>
            <tr>
              <th>单据</th>
              <th>日期</th>
              <th>状态</th>
              <th>应收</th>
              <th>净实收</th>
              <th>欠款</th>
            </tr>
          </thead>
          <tbody>
            {resource.data?.items.map((s) => (
              <tr key={s.id}>
                <td data-label="单据">
                  <Button
                    className="text-button"
                    onClick={() => onSelect(s.id)}
                  >
                    {s.number}
                  </Button>
                </td>
                <td data-label="日期">{s.business_date}</td>
                <td data-label="状态">{saleStatus(s)}</td>
                <td data-label="应收">
                  {s.status === "posted" ? `¥${moneyText(s.due)}` : "—"}
                </td>
                <td data-label="净实收">
                  {s.status === "posted" ? `¥${moneyText(s.paid)}` : "—"}
                </td>
                <td data-label="欠款">
                  {s.status === "posted" ? `¥${moneyText(s.debt)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="muted">
        草稿、作废单不计入客户应收。点击单号查看明细、补收欠款或更正收退款。
      </p>
      <div className="form-actions">
        <Button
          disabled={page === 1 || resource.loading}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <span>
          共 {resource.data?.total ?? 0} 张 · 第 {page} 页
        </span>
        <Button
          disabled={
            resource.loading || page * 50 >= (resource.data?.total ?? 0)
          }
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </Modal>
  );
}

function FinancePanel({
  user,
  revision,
  onSelect,
  section,
  navigationIndex = 0,
}: {
  user: User;
  revision: number;
  onSelect: (id: string) => void;
  section?: "debts" | "accounts" | "performance";
  navigationIndex?: number;
}) {
  const [customer, setCustomer] = useState<Finance["customers"][number]>();
  const [customerFilter, setCustomerFilter] = useQueryValue<string>(
    "finance_customers",
    "all",
  );
  const [customerSearch, setCustomerSearch] = useQueryValue<string>(
    "finance_customer_q",
    "",
  );
  const [customerPage, setCustomerPage] = useQueryValue<number>(
    "finance_customer_page",
    1,
  );
  const [performancePeriod, setPerformancePeriod] = useQueryValue<string>(
    "performance_period",
    "all",
  );
  const resource = useResource<Finance>(
    `/sales/finance?performance_period=${encodeURIComponent(performancePeriod)}`,
    revision,
  );
  const [performanceDepartment, setPerformanceDepartment] =
    useQueryValue<string>("performance_department", "");
  const [performancePerson, setPerformancePerson] = useQueryValue<string>(
    "performance_person",
    "",
  );
  const [account, setAccount] = useQueryValue<string>("finance_account", "");
  const [start, setStart] = useQueryValue<string>("finance_from", "");
  const [end, setEnd] = useQueryValue<string>("finance_to", "");
  const data = resource.data;
  const customers = (data?.customers ?? [])
    .filter(
      (c) =>
        (customerFilter !== "debt" || c.debt > 0) &&
        c.name
          .toLocaleLowerCase()
          .includes(customerSearch.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
    );
  const customerTotals = customers.reduce(
    (sum, c) => ({
      due: sum.due + c.due,
      paid: sum.paid + c.paid,
      debt: sum.debt + c.debt,
    }),
    { due: 0, paid: 0, debt: 0 },
  );
  const currentCustomerPage = Math.min(
    customerPage,
    Math.max(1, Math.ceil(customers.length / 50)),
  );
  const visibleCustomers = customers.slice(
    (currentCustomerPage - 1) * 50,
    currentCustomerPage * 50,
  );
  useEffect(() => {
    if (
      data &&
      !resource.loading &&
      !resource.error &&
      currentCustomerPage !== customerPage
    )
      setCustomerPage(currentCustomerPage);
  }, [
    data,
    resource.loading,
    resource.error,
    currentCustomerPage,
    customerPage,
    setCustomerPage,
  ]);
  const focused = useRef("");
  useEffect(() => {
    if (!data || !section) return;
    const target = `${section}-${navigationIndex}`;
    if (focused.current === target) return;
    const element = document.getElementById(`finance-${section}`);
    if (!element) return;
    focused.current = target;
    element.scrollIntoView({ block: "start" });
    element.focus({ preventScroll: true });
  }, [data, section, navigationIndex]);
  if (resource.error) return <Notice>{resource.error}</Notice>;
  if (!data) return <Loading />;
  const invalidDates = !!start && !!end && start > end;
  const entries = data.entries.filter(
    (e) =>
      (!account || e.account_id === account) &&
      (!start || e.business_date >= start) &&
      (!end || e.business_date <= end),
  );
  const selectedId = (id: string) => id || "__unassigned__";
  const matches = (selected: string, actual: string) =>
    !selected || selected === selectedId(actual);
  const departments = [
    ...new Map(
      data.performance_choices.map((row) => [
        selectedId(row.department_id),
        row.department_name || "未指定部门",
      ]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  const peopleById = new Map<
    string,
    { name: string; departments: Set<string> }
  >();
  for (const row of data.performance_choices) {
    if (!matches(performanceDepartment, row.department_id)) continue;
    const id = selectedId(row.salesperson_id);
    const person = peopleById.get(id) || {
      name: row.salesperson_name || "未指定业务员",
      departments: new Set<string>(),
    };
    person.departments.add(row.department_name || "未指定部门");
    peopleById.set(id, person);
  }
  const people = [...peopleById.entries()]
    .map(([id, person]) => [
      id,
      performanceDepartment || id === "__unassigned__"
        ? person.name
        : `${person.name} · ${[...person.departments].sort((a, b) => a.localeCompare(b, "zh-CN")).join(" / ")}`,
    ])
    .sort(
      (a, b) => a[1].localeCompare(b[1], "zh-CN") || a[0].localeCompare(b[0]),
    );
  const performance = data.performance.filter(
    (row) =>
      matches(performanceDepartment, row.department_id) &&
      matches(performancePerson, row.salesperson_id),
  );
  const performanceTotal = performance.reduce(
    (sum, row) => ({
      count: sum.count + row.count,
      due: sum.due + row.due,
      paid: sum.paid + row.paid,
      debt: sum.debt + row.debt,
    }),
    { count: 0, due: 0, paid: 0, debt: 0 },
  );
  const accounts = data.accounts
    .filter((a) => !account || a.id === account)
    .map((a) => {
      const cash = entries.filter((e) => e.account_id === a.id);
      return {
        ...a,
        received: cash.reduce((sum, e) => sum + Math.max(e.amount, 0), 0),
        refunded: cash.reduce((sum, e) => sum + Math.max(-e.amount, 0), 0),
        net: cash.reduce((sum, e) => sum + e.amount, 0),
      };
    });
  const total = entries.reduce((a, e) => a + e.amount, 0);
  const receivedTotal = accounts.reduce((sum, a) => sum + a.received, 0);
  const refundedTotal = accounts.reduce((sum, a) => sum + a.refunded, 0);
  const download = (
    rows: string[][],
    filename: string,
    numericColumns: number[],
  ) => {
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map(
              (x, column) =>
                '"' +
                (!numericColumns.includes(column) && /^[=+\-@\t\r]/.test(x)
                  ? "'"
                  : "") +
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
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel finance-panel">
      <h2>收款与欠款</h2>
      <div className="finance-summary">
        <div>
          <span>销售应收</span>
          <strong>¥{moneyText(data.due)}</strong>
          <small>
            有效单据{" "}
            {data.customers
              .reduce((sum, c) => sum + c.count, 0)
              .toLocaleString()}{" "}
            张
          </small>
        </div>
        <div>
          <span>净实收</span>
          <strong>¥{moneyText(data.paid)}</strong>
          <small>
            {data.due > 0
              ? `已收比例 ${new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(data.paid / data.due)}`
              : "暂无计款应收"}
          </small>
        </div>
        <div>
          <span>客户欠款</span>
          <strong>¥{moneyText(data.debt)}</strong>
          <small>
            {data.customers.filter((c) => c.debt > 0).length.toLocaleString()}{" "}
            户有欠款
          </small>
        </div>
      </div>
      <section
        className="finance-section"
        id="finance-debts"
        tabIndex={-1}
        aria-label="客户欠款"
      >
        <div className="section-title">
          <h3>客户对账（全部有效单据）</h3>
          <Button
            className="button small"
            onClick={() =>
              download(
                [
                  [
                    "客户ID",
                    "客户",
                    "有效单据数",
                    "应收（元）",
                    "净实收（元）",
                    "欠款（元）",
                    "最早未结清业务日期",
                    "最长欠款天数",
                  ],
                  ...customers.map((c) => [
                    c.id,
                    c.name,
                    String(c.count),
                    (c.due / 100).toFixed(2),
                    (c.paid / 100).toFixed(2),
                    (c.debt / 100).toFixed(2),
                    c.oldest_debt_date || "",
                    c.debt_days === null ? "" : String(c.debt_days),
                  ]),
                ],
                "客户往来对账.csv",
                [2, 3, 4, 5, 7],
              )
            }
          >
            导出客户对账 CSV
          </Button>
        </div>
        <div className="filters finance-customer-filters">
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <Input
              name="finance-customer-search"
              type="search"
              aria-label="搜索对账客户"
              placeholder="客户名称…"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setCustomerPage(1);
              }}
            />
          </label>
          <div className="filter-chips" role="group" aria-label="客户欠款筛选">
            {[
              [
                "debt",
                "有欠款",
                data.customers.filter((c) => c.debt > 0).length,
              ],
              ["all", "全部往来", data.customers.length],
            ].map(([value, label, count]) => (
              <Button
                key={value}
                className="filter-chip"
                aria-pressed={customerFilter === value}
                onClick={() => {
                  setCustomerFilter(String(value));
                  setCustomerPage(1);
                }}
              >
                {label}{" "}
                <span aria-hidden="true">{Number(count).toLocaleString()}</span>
              </Button>
            ))}
          </div>
        </div>
        <p className="hint">
          欠款天数从最早未结清单据的业务日期算至 {data.monthly.to}，未来日期按 0
          天；不表示合同逾期。已结清、作废及全部退货的单据不增加欠款天数。
        </p>
        {!customers.length ? (
          <Empty>
            {customerSearch || customerFilter === "debt"
              ? "没有符合条件的往来客户。"
              : "暂无有效单据往来客户。"}
          </Empty>
        ) : (
          <TableScroll>
            <table
              className="finance-ledger-table finance-customer-table"
              aria-label="客户往来账册"
            >
              <thead>
                <tr>
                  <th scope="col">客户</th>
                  <th scope="col" className="numeric">
                    应收款
                  </th>
                  <th scope="col" className="numeric">
                    净实收
                  </th>
                  <th scope="col" className="numeric">
                    欠款
                  </th>
                  <th scope="col">最长欠款天数</th>
                  <th scope="col" className="ledger-actions">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleCustomers.map((c) => (
                  <tr key={c.id}>
                    <td data-label="客户" className="finance-ledger-name">
                      {can(user, "sales.read") ? (
                        <Button
                          className="text-button"
                          onClick={() => setCustomer(c)}
                        >
                          {c.name}
                        </Button>
                      ) : (
                        <strong>{c.name}</strong>
                      )}
                      <small>有效单据 {c.count.toLocaleString()} 张</small>
                    </td>
                    <td data-label="应收款" className="numeric">
                      ¥{moneyText(c.due)}
                    </td>
                    <td data-label="净实收" className="numeric">
                      ¥{moneyText(c.paid)}
                    </td>
                    <td
                      data-label="欠款"
                      className={`numeric ${c.debt > 0 ? "finance-debt-amount" : ""}`}
                    >
                      ¥{moneyText(c.debt)}
                    </td>
                    <td data-label="最长欠款天数">
                      {c.debt_days === null ? (
                        "已结清"
                      ) : (
                        <>
                          <span
                            className={`badge ${c.debt_days > 60 ? "red" : c.debt_days > 30 ? "amber" : ""}`}
                          >
                            {c.debt_days.toLocaleString()} 天
                          </span>
                          <small>起于 {c.oldest_debt_date}</small>
                        </>
                      )}
                    </td>
                    <td data-label="操作" className="document-row-actions">
                      {can(user, "sales.read") ? (
                        <Button
                          className="button small"
                          onClick={() => setCustomer(c)}
                        >
                          对账
                        </Button>
                      ) : (
                        <span className="muted">无单据查看权限</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">筛选合计</th>
                  <td data-label="应收款" className="numeric">
                    ¥{moneyText(customerTotals.due)}
                  </td>
                  <td data-label="净实收" className="numeric">
                    ¥{moneyText(customerTotals.paid)}
                  </td>
                  <td data-label="欠款" className="numeric">
                    ¥{moneyText(customerTotals.debt)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
        <div className="pagination">
          <span role="status">
            共 {customers.length.toLocaleString()} 户 · 第 {currentCustomerPage}{" "}
            页
          </span>
          <div>
            <Button
              className="button small"
              disabled={currentCustomerPage === 1}
              onClick={() => setCustomerPage(currentCustomerPage - 1)}
            >
              上一页
            </Button>
            <Button
              className="button small"
              disabled={currentCustomerPage * 50 >= customers.length}
              onClick={() => setCustomerPage(currentCustomerPage + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
      <section
        className="finance-section"
        id="finance-accounts"
        tabIndex={-1}
        aria-label="账户流水"
      >
        <div className="filter-chips" role="group" aria-label="账户期间">
          <Button
            className="filter-chip"
            aria-pressed={
              start === data.monthly.from && end === data.monthly.to
            }
            onClick={() => {
              setStart(data.monthly.from);
              setEnd(data.monthly.to);
            }}
          >
            本月
          </Button>
          <Button
            className="filter-chip"
            aria-pressed={!start && !end}
            onClick={() => {
              setStart("");
              setEnd("");
            }}
          >
            全部日期
          </Button>
        </div>
        <div className="form-grid finance-filters">
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
          <TextField
            label="结束日期"
            type="date"
            value={end}
            onChange={setEnd}
          />
        </div>
        {invalidDates ? (
          <Notice>开始日期不能晚于结束日期，请调整日期后查看。</Notice>
        ) : (
          <>
            <h3>账户汇总（{start || end ? "筛选期间" : "全部日期"}）</h3>
            <TableScroll>
              <table
                className="finance-ledger-table finance-account-table"
                aria-label="账户汇总"
              >
                <thead>
                  <tr>
                    <th scope="col">账户</th>
                    <th scope="col" className="numeric">
                      收款合计
                    </th>
                    <th scope="col" className="numeric">
                      退款合计
                    </th>
                    <th scope="col" className="numeric">
                      净收款
                    </th>
                    <th scope="col">净收占比</th>
                    <th scope="col" className="ledger-actions">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td data-label="账户" className="finance-ledger-name">
                        <strong>{a.name}</strong>
                        <small>
                          {a.account_type || "未指定类型"}
                          {a.active === false ? " · 停用" : ""}
                        </small>
                      </td>
                      <td data-label="收款合计" className="numeric">
                        ¥{moneyText(a.received)}
                      </td>
                      <td data-label="退款合计" className="numeric">
                        ¥{moneyText(a.refunded)}
                      </td>
                      <td data-label="净收款" className="numeric">
                        ¥{moneyText(a.net)}
                      </td>
                      <td
                        data-label="净收占比"
                        className="finance-account-share"
                      >
                        {total > 0 ? (
                          <>
                            <span>
                              {new Intl.NumberFormat("zh-CN", {
                                style: "percent",
                                maximumFractionDigits: 1,
                              }).format(a.net / total)}
                            </span>
                            {a.net >= 0 && a.net <= total && (
                              <span
                                className="finance-share-track"
                                aria-hidden="true"
                              >
                                <span
                                  style={{ width: `${(a.net / total) * 100}%` }}
                                />
                              </span>
                            )}
                          </>
                        ) : (
                          <span aria-label="净收合计不大于零，不计算占比">
                            —
                          </span>
                        )}
                      </td>
                      <td data-label="操作" className="document-row-actions">
                        <Button
                          className="button small"
                          onClick={() => {
                            setAccount(a.id);
                            requestAnimationFrame(() => {
                              const heading = document.getElementById(
                                "finance-cash-entries",
                              );
                              heading?.scrollIntoView({ block: "start" });
                              heading?.focus({ preventScroll: true });
                            });
                          }}
                        >
                          查看流水
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!accounts.length && (
                    <tr>
                      <td colSpan={6}>没有符合条件的收款账户。</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">筛选合计</th>
                    <td data-label="收款合计" className="numeric">
                      ¥{moneyText(receivedTotal)}
                    </td>
                    <td data-label="退款合计" className="numeric">
                      ¥{moneyText(refundedTotal)}
                    </td>
                    <td data-label="净收款" className="numeric">
                      ¥{moneyText(total)}
                    </td>
                    <td data-label="净收占比">{total > 0 ? "100%" : "—"}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </TableScroll>
            <p className="hint">
              净收占比 = 账户净收 ÷
              筛选净收合计。合计不大于零时不计算；退款可能产生负占比或使其他账户超过
              100%，此时仅显示实际比例。
            </p>
            <h3 id="finance-cash-entries" tabIndex={-1}>
              账户收退款流水
            </h3>
            <div className="form-actions">
              <strong>筛选净收款：¥{moneyText(total)}</strong>
              <Button
                className="button"
                onClick={() =>
                  download(
                    [
                      ["单号", "日期", "账户", "金额（元）", "经办人", "备注"],
                      ...entries.map((e) => [
                        e.number,
                        e.business_date,
                        e.account_name,
                        (e.amount / 100).toFixed(2),
                        e.actor_name,
                        e.note,
                      ]),
                    ],
                    "销售收款对账.csv",
                    [3],
                  )
                }
              >
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
          </>
        )}
      </section>
      <section
        className="finance-section"
        id="finance-performance"
        tabIndex={-1}
        aria-label="部门业绩"
      >
        <div className="section-title">
          <h3>部门与业务员业绩</h3>
          <div className="filter-chips" role="group" aria-label="业绩期间">
            {[
              ["month", "本月"],
              ["quarter", "本季"],
              ["year", "本年"],
              ["all", "全部"],
            ].map(([value, label]) => (
              <Button
                key={value}
                className="filter-chip"
                aria-pressed={performancePeriod === value}
                disabled={resource.loading}
                onClick={() => setPerformancePeriod(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <p className="hint" role="status">
          {resource.loading
            ? "正在更新业绩…"
            : data.period.from
              ? `${data.period.from} 至 ${data.period.to} 开出的单据，截至当前的账款`
              : "全部有效单据，截至当前的账款"}
        </p>
        <div className="form-grid finance-filters">
          <Field label="业绩部门">
            {(p) => (
              <Select
                {...p}
                value={performanceDepartment}
                disabled={resource.loading}
                onChange={(e) => {
                  setPerformanceDepartment(e.target.value);
                  setPerformancePerson("");
                }}
              >
                <option value="">全部部门</option>
                {departments.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="业绩业务员">
            {(p) => (
              <Select
                {...p}
                value={performancePerson}
                disabled={resource.loading}
                onChange={(e) => setPerformancePerson(e.target.value)}
              >
                <option value="">全部业务员</option>
                {people.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="muted">
          按有效计款单据统计，业绩金额扣除退货，作废单不计入。实收为净收款。
        </p>
        {resource.loading ? (
          <Loading />
        ) : (
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
                {performance.map((p) => (
                  <tr key={`${p.department_id}:${p.salesperson_id}`}>
                    <td>{p.department_name || "未指定"}</td>
                    <td>{p.salesperson_name || "未指定"}</td>
                    <td>{p.count}</td>
                    <td>¥{moneyText(p.due)}</td>
                    <td>¥{moneyText(p.paid)}</td>
                    <td>¥{moneyText(p.debt)}</td>
                  </tr>
                ))}
                {!performance.length && (
                  <tr>
                    <td colSpan={6}>当前期间和业务员没有有效计款单据。</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>筛选合计</td>
                  <td>{performanceTotal.count}</td>
                  <td>¥{moneyText(performanceTotal.due)}</td>
                  <td>¥{moneyText(performanceTotal.paid)}</td>
                  <td>¥{moneyText(performanceTotal.debt)}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
      </section>
      {customer && (
        <CustomerLedger
          user={user}
          customer={
            data.customers.find((c) => c.id === customer.id) || customer
          }
          revision={revision}
          onClose={() => setCustomer(undefined)}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

interface Adjustment {
  sale_id: string;
  version: number;
  number: string;
  customer_name: string;
  action: "return" | "void";
  reason: string;
  actor_name: string;
  created_at: number;
  due_change: number;
  refund: number;
}

function AdjustmentsLedger({
  user,
  revision,
  onSelect,
  action,
  page,
  setPage,
}: {
  user: User;
  revision: number;
  onSelect: (id: string) => void;
  action: "return" | "void";
  page: number;
  setPage: (value: number) => void;
}) {
  const [search, setSearch] = useQueryValue<string>("returns_q", "");
  const [query, setQuery] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useResource<{ items: Adjustment[]; total: number }>(
    `/sales/adjustments?q=${encodeURIComponent(query)}&action=${encodeURIComponent(action)}&page=${page}`,
    revision,
  );
  const loading = resource.loading || query !== search;
  return (
    <section className="panel ledger-sheet adjustments-sheet">
      <div className="filters">
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <Input
            name="returns-search"
            type="search"
            aria-label="搜索退货与作废"
            placeholder="原单号、客户或原因…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <p className="hint">
        金额按操作当时记录；退货抵减欠款时可能没有实际退款。
        {!can(user, "sales.all") && "当前仅显示本人开单的退货与作废。"}
      </p>
      {resource.error && <Notice>{resource.error}</Notice>}
      {loading ? (
        <Loading />
      ) : resource.data?.items.length ? (
        <TableScroll>
          <table className="adjustments-table" aria-label="退货与作废记录">
            <thead>
              <tr>
                <th scope="col">关联原单 / 版本</th>
                <th scope="col">客户 / 原因</th>
                <th scope="col">动作</th>
                <th scope="col" className="numeric">
                  应收变化
                </th>
                <th scope="col" className="numeric">
                  实际退款
                </th>
                <th scope="col">经办人 / 记录时间</th>
                <th scope="col" className="ledger-actions">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {resource.data.items.map((record) => (
                <tr key={`${record.sale_id}-${record.version}`}>
                  <td data-label="关联原单" className="adjustment-number">
                    <Button
                      className="text-button"
                      onClick={() => onSelect(record.sale_id)}
                    >
                      {record.number}
                    </Button>
                    <small>第 {record.version} 版</small>
                  </td>
                  <td data-label="客户 / 原因" className="adjustment-reason">
                    <strong>{record.customer_name}</strong>
                    <small>{record.reason}</small>
                  </td>
                  <td data-label="动作">
                    <span
                      className={`badge ${record.action === "return" ? "amber" : ""}`}
                    >
                      {record.action === "return" ? "退货" : "作废"}
                    </span>
                  </td>
                  <td data-label="应收变化" className="numeric">
                    {record.due_change < 0 ? "−" : ""}¥
                    {moneyText(Math.abs(record.due_change))}
                  </td>
                  <td data-label="实际退款" className="numeric">
                    ¥{moneyText(record.refund)}
                  </td>
                  <td data-label="经办人 / 记录时间">
                    <strong>{record.actor_name}</strong>
                    <small>{dateTime(record.created_at)}</small>
                  </td>
                  <td className="document-row-actions" data-label="操作">
                    <Button
                      className="button small"
                      onClick={() => onSelect(record.sale_id)}
                    >
                      查看原单
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        resource.data && (
          <Empty>
            {query
              ? `没有符合筛选条件的${action === "return" ? "退货" : "作废"}记录。`
              : `暂无${action === "return" ? "退货" : "作废"}记录；可在原单详情办理。`}
          </Empty>
        )
      )}
      <div className="form-actions">
        <Button
          disabled={page === 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </Button>
        <span>
          共 {resource.data?.total ?? 0} 条 · 第 {page} 页
        </span>
        <Button
          disabled={loading || page * 50 >= (resource.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}

export default function Sales({
  user,
  revision,
  refresh,
  onDirtyChange,
  view = "sales",
  initialItem,
  startNew = false,
  onOpenList,
  financeSection,
  navigationIndex = 0,
}: {
  view?: "sales" | "finance" | "customers" | "catalog" | "returns";
  initialItem?: Item;
  startNew?: boolean;
  onOpenList?: (id?: string) => void;
  financeSection?: "debts" | "accounts" | "performance";
  navigationIndex?: number;
  user: User;
  revision: number;
  refresh: () => void;
  onDirtyChange: (v: boolean) => void;
}) {
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const financeView = view === "finance";
  const returnsView = view === "returns";
  const configView = view === "customers" || view === "catalog";
  const [tab, setTab] = useState(
    configView ? "config" : financeView ? "finance" : "list",
  );
  const [recordKind, setRecordKind] = useQueryValue<string>(
    "sales_records",
    returnsView
      ? new URLSearchParams(location.search).get("returns_action") === "void"
        ? "void"
        : "return"
      : "documents",
  );
  const adjustmentAction =
    recordKind === "return" || recordKind === "void" ? recordKind : undefined;
  const [adjustmentPage, setAdjustmentPage] = useQueryValue<number>(
    "returns_page",
    1,
  );
  const [search, setSearch] = useQueryValue<string>("sales_q", "");
  const [query, setQuery] = useState(search);
  const [listStatus, setListStatus] = useQueryValue<string>("sales_status", "");
  const [listFrom, setListFrom] = useQueryValue<string>("sales_from", "");
  const [listTo, setListTo] = useQueryValue<string>("sales_to", "");
  const [page, setPage] = useQueryValue<number>("sales_page", 1);
  const [selected, setSelected] = useState<Sale>();
  const [openSaleId, setOpenSaleId] = useQueryValue<string>("sale_open", "");
  const [editing, setEditing] = useState(startNew || !!initialItem);
  const [prefill, setPrefill] = useState(initialItem);
  const [config, setConfig] = useState<{
    kind: CatalogEntry["kind"];
    entry?: CatalogEntry;
  }>();
  const [local, setLocal] = useState(0);
  const [ledgerCustomerId, setLedgerCustomerId] = useQueryValue<string>(
    "customer_ledger",
    "",
  );
  const [customerSearch, setCustomerSearch] = useQueryValue<string>(
    "customer_q",
    "",
  );
  const [focusedCustomer, setFocusedCustomer] = useQueryValue<string>(
    "customer_focus",
    "",
  );
  const showCustomerFinance = view === "customers" && can(user, "finance.read");
  const customerFinance = useResource<Finance>(
    showCustomerFinance ? "/sales/finance" : undefined,
    revision + local,
  );
  const customerBalances = new Map(
    customerFinance.data?.customers.map((c) => [c.id, c]),
  );
  const action = useAction();
  const catalog = useResource<{ items: CatalogEntry[] }>(
    "/sales/catalog",
    revision + local,
  );
  const catalogFinance = useResource<Finance>(
    view === "catalog" && can(user, "finance.read")
      ? "/sales/finance"
      : undefined,
    revision + local,
  );
  const options = useResource<{ items: MaterialOption[] }>(
    view === "catalog" && can(user, "options.read")
      ? "/material-options"
      : undefined,
    revision + local,
  );
  const list = useResource<{
    items: Sale[];
    total: number;
    counts: Record<string, number>;
  }>(
    (view === "sales" || returnsView) &&
      !startNew &&
      !adjustmentAction &&
      can(user, "sales.read")
      ? `/sales?q=${encodeURIComponent(query)}&status=${encodeURIComponent(listStatus)}&from=${encodeURIComponent(listFrom)}&to=${encodeURIComponent(listTo)}&page=${page}`
      : undefined,
    revision + local,
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  const [savedEntries, setSavedEntries] = useState<
    Record<string, CatalogEntry>
  >({});
  const entries = Object.values({
    ...savedEntries,
    ...Object.fromEntries(
      (catalog.data?.items || []).map((entry) => [entry.id, entry]),
    ),
  });
  const catalogCreated = (entry: CatalogEntry) => {
    setSavedEntries((current) => ({ ...current, [entry.id]: entry }));
    setLocal((n) => n + 1);
  };
  const changed = (sale: Sale) => {
    setSelected(sale);
    setLocal((n) => n + 1);
    refresh();
  };
  const select = (id: string, edit = false) =>
    action.run(async () => {
      setSelected(await api<Sale>(`/sales/${id}`));
      setEditing(edit);
      setTab(configView ? "config" : financeView ? "finance" : "list");
    });
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("sale_print");
    if (startNew) return;
    if (id) void select(id);
    else if ((view === "sales" || returnsView) && openSaleId)
      void select(openSaleId);
  }, [openSaleId]);
  useEffect(() => {
    const id = selected?.id;
    if (!id || editing) return;
    const controller = new AbortController();
    void api<Sale>(`/sales/${id}`, { signal: controller.signal })
      .then((sale) => {
        if (!controller.signal.aborted) setSelected(sale);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [revision, selected?.id, editing]);
  useEffect(() => {
    if (!financeSection) return;
    setSelected(undefined);
    setEditing(false);
    setTab("finance");
  }, [financeSection, navigationIndex]);
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
      setPrefill(undefined);
      if (startNew) onOpenList?.();
    }
  };
  const [configKind, setConfigKind] = useState<
    CatalogEntry["kind"] | "spec" | "kind" | "unit"
  >(
    view === "customers"
      ? "customer"
      : can(user, "catalog.read")
        ? "type"
        : can(user, "options.read")
          ? "spec"
          : "account",
  );
  const [importing, setImporting] = useState<string>();
  const visibleConfigKind = view === "customers" ? "customer" : configKind;
  const configLabels: Record<string, string> = {
    type: "单据类型",
    account: "收款账户",
    department: "部门",
    salesperson: "业务员",
    kind: "物料分类",
    unit: "计量单位",
    spec: "常用规格",
    company: "公司信息",
    customer: "客户",
  };
  const configRows = entries
    .filter((c) => c.kind === visibleConfigKind)
    .filter(
      (c) =>
        view !== "customers" ||
        (focusedCustomer
          ? c.id === focusedCustomer
          : [c.name, c.data.contact, c.data.phone].some((v) =>
              v?.toLowerCase().includes(customerSearch.trim().toLowerCase()),
            )),
    )
    .sort(
      (a, b) =>
        (a.data.sort ?? 0) - (b.data.sort ?? 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  const configModule =
    visibleConfigKind === "customer"
      ? "customers"
      : visibleConfigKind === "account"
        ? "accounts"
        : ["spec", "kind", "unit"].includes(visibleConfigKind)
          ? "options"
          : "catalog";
  const configOrder = useDictionaryOrder(
    configRows,
    visibleConfigKind,
    catalog.loading,
    view === "catalog" &&
      ["type", "account", "department", "salesperson"].includes(
        visibleConfigKind,
      ) &&
      can(user, `${configModule}.update`) &&
      !action.busy,
    () => {
      setLocal((n) => n + 1);
      refresh();
    },
  );
  const contactFields = ["customer", "company"].includes(visibleConfigKind);
  const openConfig = () =>
    setConfig({
      kind: visibleConfigKind as CatalogEntry["kind"],
      entry: visibleConfigKind === "company" ? configRows[0] : undefined,
    });
  const ledgerCustomer = entries.find(
    (c) => c.kind === "customer" && c.id === ledgerCustomerId,
  );
  const showCatalogUsage = can(user, "sales.all") || can(user, "finance.read");
  const updateCatalog = (entry: CatalogEntry, patch: Partial<CatalogEntry>) =>
    void action.run(async () => {
      const billableChange = patch.data?.billable !== undefined;
      if (
        !(await confirm({
          title: billableChange
            ? `修改“${entry.name}”的计款规则？`
            : `${patch.active ? "启用" : "停用"}“${entry.name}”？`,
          description: billableChange
            ? "仅影响后续新开单据，历史单据的应收与欠款不变。"
            : patch.active
              ? "启用后可以在新单据中选择。"
              : "停用后不再用于新单据，已有单据和历史记录保留。",
          confirmLabel: billableChange
            ? "确认修改"
            : patch.active
              ? "确认启用"
              : "确认停用",
        }))
      )
        return;
      catalogCreated(
        await send<CatalogEntry>("/sales/catalog", { ...entry, ...patch }),
      );
    });
  const deleteCatalog = (entry: CatalogEntry) =>
    void action.run(async () => {
      if (
        !(await confirm({
          title: `删除“${entry.name}”？`,
          description: "仅能删除没有单据或业务员关联的资料。此操作会留下记录。",
          confirmLabel: "删除资料",
        }))
      )
        return;
      await send(
        `/sales/catalog/${entry.id}?version=${entry.version}`,
        {},
        "DELETE",
      );
      setSavedEntries((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      setLocal((n) => n + 1);
    });
  return (
    <Tabs
      className="sales-page"
      value={tab}
      onValueChange={(value) => {
        setTab(value);
        setSelected(undefined);
      }}
    >
      <div className="page-heading">
        <div>
          <h1>
            {configView
              ? view === "customers"
                ? "客户"
                : "基础资料"
              : financeView
                ? "收款"
                : startNew
                  ? "开单"
                  : "单据"}
          </h1>
          <p>
            {configView
              ? view === "customers"
                ? "维护客户与联系信息，历史单据保留原记录。"
                : "全站常用选项在这里统一维护；修改候选不重写历史单据。"
              : financeView
                ? "核对客户欠款、收款账户流水与部门业务员业绩。"
                : startNew
                  ? "一张单开齐物料，库存与收款同步记录。"
                  : "查询单据、退货与作废记录，核对库存与收款。"}
          </p>
        </div>
        {configView && visibleConfigKind !== "company" && (
          <div className="row-actions">
            {can(user, `${configModule}.create`) && (
              <Button onClick={() => setImporting(visibleConfigKind)}>
                导入{configLabels[visibleConfigKind]}
              </Button>
            )}
            {can(user, `${configModule}.read`) &&
              ["csv", "xlsx"].map((format) => (
                <a
                  key={format}
                  className="button"
                  href={`/api/export/${visibleConfigKind}?format=${format}${view === "customers" ? `&q=${encodeURIComponent(customerSearch)}&customer_id=${encodeURIComponent(focusedCustomer)}` : ""}`}
                >
                  导出 {format === "csv" ? "CSV" : "Excel"}
                </a>
              ))}
            {view === "customers" && can(user, "customers.create") && (
              <Button className="button primary" onClick={openConfig}>
                <Plus size={18} aria-hidden="true" />
                新增客户
              </Button>
            )}
          </div>
        )}
        {!editing &&
          !financeView &&
          !configView &&
          (can(user, "sales.create") || user.role === "admin") && (
            <div className="row-actions">
              {user.role === "admin" &&
                !selected &&
                tab === "list" &&
                !adjustmentAction && (
                  <a
                    className="button"
                    href={`/api/export/sales?format=csv&q=${encodeURIComponent(query)}&status=${encodeURIComponent(listStatus)}&from=${encodeURIComponent(listFrom)}&to=${encodeURIComponent(listTo)}`}
                  >
                    导出 CSV
                  </a>
                )}
              {can(user, "sales.create") && (
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
          )}
      </div>
      <TabsList
        aria-label="开单栏目"
        hidden={editing || financeView || configView}
      >
        <Tab value="list">单据列表</Tab>
        {can(user, "finance.read") && <Tab value="finance">收款与欠款</Tab>}
      </TabsList>
      <TabsPanel value={tab}>
        {!editing &&
          !selected &&
          !configView &&
          !financeView &&
          tab === "list" && (
            <div
              className="filter-chips document-record-filters"
              role="group"
              aria-label="单据记录筛选"
            >
              {[
                ["documents", "单据"],
                ["return", "退货记录"],
                ["void", "作废记录"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  className="filter-chip"
                  aria-pressed={value === (adjustmentAction || "documents")}
                  onClick={() => {
                    setRecordKind(value);
                    setAdjustmentPage(1);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        {(catalog.error || action.error || customerFinance.error) && (
          <Notice>
            {catalog.error || action.error || customerFinance.error}
          </Notice>
        )}
        {editing ? (
          <SaleEditor
            key={selected?.id || "new"}
            sale={selected}
            initialItem={selected ? undefined : prefill}
            user={user}
            catalog={entries}
            onDirtyChange={onDirtyChange}
            onCatalogCreated={catalogCreated}
            onClose={() => void closeEditor()}
            onDone={(s) => {
              changed(s);
              setPrefill(undefined);
              setEditing(false);
              if (startNew) onOpenList?.(s.id);
            }}
          />
        ) : selected ? (
          <Detail
            onCatalogCreated={catalogCreated}
            backLabel={
              view === "customers"
                ? "返回客户对账"
                : financeView
                  ? "返回收款"
                  : "返回列表"
            }
            sale={selected}
            user={user}
            catalog={entries}
            onEdit={() => setEditing(true)}
            onChange={changed}
            onClose={() => {
              setSelected(undefined);
              setOpenSaleId("");
            }}
          />
        ) : tab === "list" && adjustmentAction ? (
          <AdjustmentsLedger
            user={user}
            revision={revision + local}
            onSelect={(id) => void select(id)}
            action={adjustmentAction}
            page={adjustmentPage}
            setPage={setAdjustmentPage}
          />
        ) : tab === "list" ? (
          <section className="panel ledger-sheet sale-list-sheet">
            <div className="filters sale-filters">
              <label className="search">
                <Search size={18} />
                <Input
                  aria-label="搜索销售单"
                  name="sales-search"
                  type="search"
                  placeholder="客户、单号或物料名称…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <Field label="业务日期从">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={listFrom}
                    onChange={(e) => {
                      setListFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                )}
              </Field>
              <Field label="业务日期至">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={listTo}
                    onChange={(e) => {
                      setListTo(e.target.value);
                      setPage(1);
                    }}
                  />
                )}
              </Field>
            </div>
            <div
              className="filter-chips"
              role="group"
              aria-label="单据状态筛选"
            >
              {[
                ["", "全部"],
                ["draft", "草稿"],
                ["posted", "已确认"],
                ["voided", "已作废"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  className="filter-chip"
                  aria-pressed={listStatus === value}
                  onClick={() => {
                    setListStatus(value);
                    setPage(1);
                  }}
                >
                  {label}{" "}
                  <span aria-hidden="true">
                    {list.data?.counts?.[value || "all"]?.toLocaleString() ??
                      "…"}
                  </span>
                </Button>
              ))}
            </div>
            {list.error && <Notice>{list.error}</Notice>}
            {list.loading && <Loading />}
            {!!list.data?.items.length && (
              <TableScroll>
                <table className="sale-list-table" aria-label="销售单据列表">
                  <thead>
                    <tr>
                      <th scope="col">单号</th>
                      <th scope="col">单据类型</th>
                      <th scope="col">客户</th>
                      <th scope="col">业务日期</th>
                      <th scope="col">开单 / 业绩归属</th>
                      <th scope="col">单据状态</th>
                      <th scope="col">收款状态</th>
                      <th scope="col" className="numeric">
                        金额 / 欠款
                      </th>
                      <th scope="col" className="ledger-actions">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map((s) => (
                      <tr key={s.id}>
                        <td className="sale-list-number">
                          <Button
                            className="sale-list-item"
                            disabled={
                              action.busy || list.loading || search !== query
                            }
                            onClick={() => void select(s.id)}
                          >
                            <strong>{s.number}</strong>
                            <small>{s.lines.length} 种物料</small>
                          </Button>
                        </td>
                        <td className="sale-list-type" data-label="单据类型">
                          {s.type_name}
                        </td>
                        <td data-label="客户">
                          <strong>{s.customer.name}</strong>
                        </td>
                        <td data-label="业务日期">{s.business_date}</td>
                        <td data-label="开单 / 业绩归属">
                          <span>{s.actor_name}</span>
                          <small>
                            {s.department_name || "未指定"} →{" "}
                            {s.salesperson_name || "未指定"}
                          </small>
                        </td>
                        <td data-label="单据状态">
                          <span
                            className={`badge ${s.status === "posted" ? "green" : s.status === "draft" ? "amber" : ""}`}
                          >
                            {
                              {
                                draft: "草稿",
                                posted: "已确认",
                                voided: "已作废",
                              }[s.status]
                            }
                          </span>
                        </td>
                        <td data-label="收款状态">
                          <span
                            className={`badge ${s.status === "posted" && s.billable ? (s.debt > 0 ? "amber" : "green") : ""}`}
                          >
                            {s.status === "draft"
                              ? "未记账"
                              : s.status === "voided"
                                ? "已冲销"
                                : !s.billable
                                  ? "不计款"
                                  : s.debt <= 0
                                    ? "已结清"
                                    : s.paid > 0
                                      ? "部分收款"
                                      : "未收款"}
                          </span>
                        </td>
                        <td className="numeric" data-label="金额 / 欠款">
                          {s.billable ? (
                            <>
                              <strong>
                                ¥
                                {moneyText(
                                  s.status === "draft" ? s.total : s.due,
                                )}
                              </strong>
                              <small>
                                {s.status === "draft"
                                  ? "草稿金额 · 未记账"
                                  : `欠款 ¥${moneyText(s.debt)}`}
                              </small>
                            </>
                          ) : (
                            "不计款"
                          )}
                        </td>
                        <td className="document-row-actions" data-label="操作">
                          <div className="row-actions">
                            <Button
                              className="button small"
                              disabled={
                                action.busy || list.loading || search !== query
                              }
                              onClick={() => void select(s.id)}
                            >
                              查看
                            </Button>
                            {s.status === "draft" &&
                              can(user, "sales.create") && (
                                <Button
                                  className="button small"
                                  disabled={
                                    action.busy ||
                                    list.loading ||
                                    search !== query
                                  }
                                  onClick={() => void select(s.id, true)}
                                >
                                  编辑草稿
                                </Button>
                              )}
                            {s.status === "posted" &&
                              can(user, "sales.revise") && (
                                <Button
                                  className="button small"
                                  disabled={
                                    action.busy ||
                                    list.loading ||
                                    search !== query
                                  }
                                  onClick={() => void select(s.id, true)}
                                >
                                  修订
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
            {list.data && !list.data.items.length && (
              <Empty>
                {query || listStatus || listFrom || listTo
                  ? "没有符合筛选条件的单据。"
                  : "暂无单据，点击新建单据开始。"}
              </Empty>
            )}
            <div className="form-actions">
              <Button
                className="button"
                disabled={page === 1 || list.loading || search !== query}
                onClick={() => setPage((n) => n - 1)}
              >
                上一页
              </Button>
              <span>
                共 {list.data?.total ?? 0} 张 · 第 {page} 页
              </span>
              <Button
                className="button"
                disabled={
                  list.loading ||
                  search !== query ||
                  page * 50 >= (list.data?.total ?? 0)
                }
                onClick={() => setPage((n) => n + 1)}
              >
                下一页
              </Button>
            </div>
          </section>
        ) : tab === "finance" && can(user, "finance.read") ? (
          <FinancePanel
            section={financeSection}
            navigationIndex={navigationIndex}
            user={user}
            revision={revision + local}
            onSelect={(id) => void select(id)}
          />
        ) : (
          <Tabs
            className={view === "catalog" ? "dictionary" : "catalog-customers"}
            orientation={compact ? "horizontal" : "vertical"}
            value={visibleConfigKind}
            onValueChange={(value) => setConfigKind(value as typeof configKind)}
          >
            <aside className="dictionary-side" hidden={view === "customers"}>
              <div className="dictionary-label">选项清单</div>
              <TabsList aria-label="销售配置栏目" hidden={view === "customers"}>
                {[
                  "type",
                  "account",
                  "department",
                  "salesperson",
                  "kind",
                  "unit",
                  "spec",
                  "company",
                ]
                  .filter((k) =>
                    can(
                      user,
                      `${["spec", "kind", "unit"].includes(k) ? "options" : k === "account" ? "accounts" : "catalog"}.read`,
                    ),
                  )
                  .map((k) => (
                    <Tab key={k} value={k} aria-label={configLabels[k]}>
                      <span>{configLabels[k]}</span>
                      <span className="dictionary-count" aria-hidden="true">
                        {["spec", "kind", "unit"].includes(k)
                          ? options.loading || options.error
                            ? "—"
                            : (options.data?.items.filter((o) => o.field === k)
                                .length ?? 0)
                          : catalog.loading || catalog.error
                            ? "—"
                            : entries.filter((c) => c.kind === k).length}
                      </span>
                    </Tab>
                  ))}
              </TabsList>
              <p className="dictionary-tip">
                建档时手输的规格、分类和单位，保存成功后自动加入候选清单。
              </p>
            </aside>
            <TabsPanel
              className="ledger-sheet dictionary-main"
              value={visibleConfigKind}
            >
              {["spec", "kind", "unit"].includes(visibleConfigKind) ? (
                <MaterialOptions
                  key={visibleConfigKind}
                  user={user}
                  field={visibleConfigKind as "spec" | "kind" | "unit"}
                  resource={options}
                  finance={catalogFinance}
                  refresh={() => {
                    setLocal((n) => n + 1);
                    refresh();
                  }}
                />
              ) : (
                <>
                  <div className="section-title ledger-heading">
                    <h2>{configLabels[visibleConfigKind]}</h2>
                    <p className="muted">
                      {visibleConfigKind === "type"
                        ? "维护名称、计款规则与启停状态；历史单据保留原记录。"
                        : visibleConfigKind === "salesperson"
                          ? "业务员归属部门，与实际开单人分别记录。"
                          : contactFields
                            ? "维护名称、联系信息与启停状态。"
                            : "停用后不再用于新单据，历史记录仍可查看。"}
                    </p>
                  </div>
                  {view === "customers" && (
                    <>
                      <div className="filters">
                        <label className="search">
                          <Search size={18} aria-hidden="true" />
                          <Input
                            type="search"
                            name="customer-search"
                            aria-label="搜索客户"
                            placeholder="客户名称、联系人或电话…"
                            maxLength={100}
                            value={customerSearch}
                            onChange={(e) => {
                              setCustomerSearch(e.target.value);
                              setFocusedCustomer("");
                            }}
                          />
                        </label>
                      </div>
                      {focusedCustomer && (
                        <div className="search-location" role="status">
                          <span>已定位到搜索选中的客户</span>
                          <Button
                            className="text-button"
                            onClick={() => {
                              setFocusedCustomer("");
                              setCustomerSearch("");
                            }}
                          >
                            查看全部客户
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {view === "catalog" &&
                    can(user, "finance.read") &&
                    ["account", "department", "salesperson"].includes(
                      visibleConfigKind,
                    ) && (
                      <>
                        {catalogFinance.error && (
                          <Notice>{catalogFinance.error}</Notice>
                        )}
                        <p className="dictionary-feedback">
                          本月截至{catalogFinance.data?.monthly.to || "今日"}；
                          {visibleConfigKind === "account"
                            ? "按收退款业务日期统计实际净收。"
                            : "按单据业务日期统计当前应收，扣退货、排除作废；与实际现金流分别记录。"}
                        </p>
                      </>
                    )}
                  {configOrder.error && <Notice>{configOrder.error}</Notice>}
                  <p className="dictionary-feedback" role="status">
                    {configOrder.message}
                  </p>
                  {catalog.loading ? (
                    <Loading />
                  ) : !configRows.length ? (
                    <Empty>暂无{configLabels[visibleConfigKind]}</Empty>
                  ) : (
                    <TableScroll>
                      <table
                        className={`dictionary-table${view === "customers" ? " customer-table" : ""}`}
                        aria-label={`${configLabels[visibleConfigKind]}列表`}
                      >
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              className={`ledger-sequence${view === "catalog" && visibleConfigKind !== "company" ? " dictionary-order-cell" : ""}`}
                            >
                              序
                            </th>
                            <th scope="col">名称</th>
                            {visibleConfigKind === "account" && (
                              <th scope="col">类型</th>
                            )}
                            {visibleConfigKind === "department" && (
                              <th scope="col">负责人</th>
                            )}
                            {visibleConfigKind === "type" && (
                              <th scope="col">要不要收款</th>
                            )}
                            {visibleConfigKind === "salesperson" && (
                              <th scope="col">所属部门</th>
                            )}
                            {contactFields && (
                              <>
                                {view !== "customers" && (
                                  <th scope="col">联系人</th>
                                )}
                                <th scope="col">联系电话</th>
                                {view !== "customers" && (
                                  <th scope="col">地址</th>
                                )}
                              </>
                            )}
                            {view !== "customers" && <th scope="col">状态</th>}
                            {showCatalogUsage &&
                              visibleConfigKind !== "company" && (
                                <th scope="col" className="numeric">
                                  关联单据
                                </th>
                              )}
                            {visibleConfigKind === "department" && (
                              <th scope="col" className="numeric">
                                业务员
                              </th>
                            )}
                            {view === "catalog" &&
                              can(user, "finance.read") &&
                              ["account", "department", "salesperson"].includes(
                                visibleConfigKind,
                              ) && (
                                <th scope="col" className="numeric">
                                  {visibleConfigKind === "account"
                                    ? "本月实际净收"
                                    : "本月业绩"}
                                </th>
                              )}
                            {showCustomerFinance && (
                              <>
                                <th scope="col" className="numeric">
                                  应收合计
                                </th>
                                <th scope="col" className="numeric">
                                  净实收
                                </th>
                                <th scope="col" className="numeric">
                                  欠款
                                </th>
                              </>
                            )}
                            {view !== "customers" && <th scope="col">说明</th>}
                            <th scope="col" className="ledger-actions">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {configRows.map((c, index) => (
                            <tr key={c.id} {...configOrder.rowProps(c)}>
                              <td
                                className={`ledger-sequence${view === "catalog" && visibleConfigKind !== "company" ? " dictionary-order-cell" : ""}`}
                              >
                                {view === "catalog" &&
                                visibleConfigKind !== "company"
                                  ? configOrder.controls(c, index)
                                  : index + 1}
                              </td>
                              <td className="ledger-name" data-label="名称">
                                <strong>{c.name}</strong>
                                {view === "customers" && (
                                  <>
                                    <small>
                                      {c.data.contact || "未填写联系人"}
                                      {!c.active && " · 已停用"}
                                    </small>
                                    {c.data.address && (
                                      <small>{c.data.address}</small>
                                    )}
                                    {c.data.note && (
                                      <small>{c.data.note}</small>
                                    )}
                                  </>
                                )}
                              </td>
                              {c.kind === "account" && (
                                <td data-label="类型">
                                  {c.data.account_type || "未指定"}
                                </td>
                              )}
                              {c.kind === "department" && (
                                <td data-label="负责人">
                                  {c.data.contact || "—"}
                                </td>
                              )}
                              {c.kind === "type" && (
                                <td data-label="要不要收款">
                                  <Button
                                    className="dictionary-switch"
                                    role="switch"
                                    aria-label={`${c.name}计款`}
                                    aria-checked={!!c.data.billable}
                                    disabled={
                                      !can(user, "catalog.update") ||
                                      action.busy ||
                                      configOrder.busy
                                    }
                                    onClick={() =>
                                      updateCatalog(c, {
                                        data: {
                                          ...c.data,
                                          billable: !c.data.billable,
                                        },
                                      })
                                    }
                                  >
                                    <span aria-hidden="true" />
                                  </Button>
                                </td>
                              )}
                              {c.kind === "salesperson" && (
                                <td data-label="所属部门">
                                  {entries.find(
                                    (d) => d.id === c.data.department_id,
                                  )?.name || "未指定部门"}
                                </td>
                              )}
                              {contactFields && (
                                <>
                                  {view !== "customers" && (
                                    <td data-label="联系人">
                                      {c.data.contact || "—"}
                                    </td>
                                  )}
                                  <td data-label="联系电话">
                                    {c.data.phone || "—"}
                                  </td>
                                  {view !== "customers" && (
                                    <td data-label="地址">
                                      {c.data.address || "—"}
                                    </td>
                                  )}
                                </>
                              )}
                              {view !== "customers" && (
                                <td data-label="状态">
                                  <span
                                    className={`badge ${c.active ? "green" : ""}`}
                                  >
                                    {c.active ? "启用" : "停用"}
                                  </span>
                                </td>
                              )}
                              {showCatalogUsage && c.kind !== "company" && (
                                <td className="numeric" data-label="关联单据">
                                  {c.usage_count?.toLocaleString() ?? "统计中…"}
                                </td>
                              )}
                              {c.kind === "department" && (
                                <td className="numeric" data-label="业务员">
                                  {c.member_count?.toLocaleString() ?? "—"}
                                </td>
                              )}
                              {view === "catalog" &&
                                can(user, "finance.read") &&
                                [
                                  "account",
                                  "department",
                                  "salesperson",
                                ].includes(c.kind) && (
                                  <td
                                    className="numeric"
                                    data-label={
                                      c.kind === "account"
                                        ? "本月实际净收"
                                        : "本月业绩"
                                    }
                                  >
                                    {catalogFinance.loading
                                      ? "统计中…"
                                      : catalogFinance.error
                                        ? "未加载"
                                        : `¥${moneyText(catalogFinance.data?.monthly[c.kind === "account" ? "accounts" : c.kind === "department" ? "departments" : "salespeople"][c.id] ?? 0)}`}
                                  </td>
                                )}
                              {showCustomerFinance &&
                                (
                                  [
                                    ["due", "应收合计"],
                                    ["paid", "净实收"],
                                    ["debt", "欠款"],
                                  ] as const
                                ).map(([key, label]) => (
                                  <td
                                    key={key}
                                    className="numeric"
                                    data-label={label}
                                  >
                                    {customerFinance.loading
                                      ? "统计中…"
                                      : customerFinance.error
                                        ? "未加载"
                                        : `¥${moneyText(customerBalances.get(c.id)?.[key] ?? 0)}`}
                                  </td>
                                ))}
                              {view !== "customers" && (
                                <td className="ledger-note" data-label="说明">
                                  {c.data.note || "—"}
                                </td>
                              )}
                              <td className="ledger-actions">
                                <div className="row-actions">
                                  {showCustomerFinance &&
                                    can(user, "sales.read") && (
                                      <Button
                                        className="button ledger-edit"
                                        disabled={
                                          customerFinance.loading ||
                                          !!customerFinance.error
                                        }
                                        onClick={() =>
                                          setLedgerCustomerId(c.id)
                                        }
                                      >
                                        {can(user, "sales.all")
                                          ? "对账"
                                          : "本人单据"}
                                      </Button>
                                    )}
                                  {can(user, `${configModule}.update`) ? (
                                    <>
                                      <Button
                                        className="button ledger-edit"
                                        disabled={
                                          action.busy || configOrder.busy
                                        }
                                        onClick={() =>
                                          setConfig({ kind: c.kind, entry: c })
                                        }
                                      >
                                        <Pencil size={14} aria-hidden="true" />
                                        修改
                                      </Button>
                                      {c.kind !== "company" && (
                                        <Button
                                          className="button ledger-edit"
                                          disabled={
                                            action.busy || configOrder.busy
                                          }
                                          onClick={() =>
                                            updateCatalog(c, {
                                              active: !c.active,
                                            })
                                          }
                                        >
                                          {c.active ? "停用" : "启用"}
                                        </Button>
                                      )}
                                    </>
                                  ) : (
                                    <span className="muted">只读</span>
                                  )}
                                  {can(user, `${configModule}.delete`) &&
                                    c.kind !== "company" && (
                                      <Button
                                        className="button danger-outline"
                                        disabled={
                                          action.busy ||
                                          configOrder.busy ||
                                          !c.can_delete
                                        }
                                        title={
                                          !c.can_delete
                                            ? "已有单据或业务员关联，只能停用"
                                            : undefined
                                        }
                                        onClick={() => deleteCatalog(c)}
                                      >
                                        删除
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
                  {view !== "customers" &&
                    can(
                      user,
                      `${configModule}.${visibleConfigKind === "company" && configRows.length ? "update" : "create"}`,
                    ) && (
                      <div className="ledger-footer">
                        <Button className="dictionary-add" onClick={openConfig}>
                          {visibleConfigKind === "company" &&
                          configRows.length ? (
                            <Pencil size={16} aria-hidden="true" />
                          ) : (
                            <Plus size={16} aria-hidden="true" />
                          )}
                          {visibleConfigKind === "company" && configRows.length
                            ? "设置公司信息"
                            : `新增${configLabels[visibleConfigKind]}`}
                        </Button>
                      </div>
                    )}
                </>
              )}
            </TabsPanel>
          </Tabs>
        )}
      </TabsPanel>
      {showCustomerFinance &&
        can(user, "sales.read") &&
        ledgerCustomer &&
        !selected &&
        !editing &&
        customerFinance.data &&
        !customerFinance.error && (
          <CustomerLedger
            key={ledgerCustomer.id}
            user={user}
            customer={{
              ...(customerBalances.get(ledgerCustomer.id) ?? {
                due: 0,
                paid: 0,
                debt: 0,
                count: 0,
                oldest_debt_date: null,
                debt_days: null,
              }),
              id: ledgerCustomer.id,
              name: ledgerCustomer.name,
            }}
            revision={revision + local}
            onSelect={(id) => void select(id)}
            onClose={() => setLedgerCustomerId("")}
          />
        )}
      {config && (
        <ConfigForm
          user={user}
          catalog={entries}
          onCatalogCreated={catalogCreated}
          kind={config.kind}
          entry={config.entry}
          onClose={() => setConfig(undefined)}
          onDone={(entry) => {
            setConfig(undefined);
            catalogCreated(entry);
          }}
        />
      )}
      {importing && (
        <Modal
          title={`导入${configLabels[importing]}`}
          onClose={() => setImporting(undefined)}
        >
          <TableImport
            mode={importing}
            onClose={() => setImporting(undefined)}
            onImported={() => {
              setLocal((n) => n + 1);
              refresh();
            }}
          />
        </Modal>
      )}
    </Tabs>
  );
}
