export interface CatalogEntry {
  id: string;
  kind:
    "customer" | "type" | "account" | "company" | "department" | "salesperson";
  name: string;
  active: boolean;
  version: number;
  data: {
    department_id?: string;
    phone?: string;
    contact?: string;
    address?: string;
    billable?: boolean;
    sort?: number;
  };
}
export interface SaleInput {
  customer_id: string;
  department_id?: string;
  salesperson_id?: string;
  type_id: string;
  type_name?: string;
  type_billable?: boolean;
  business_date: string;
  note: string;
  discount_rate: string;
  rounding: string;
  lines: { item_id: string; quantity: string; price: string }[];
}
export interface SaleLine {
  item_id: string;
  name: string;
  code: string;
  spec: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  allocated: number;
}
export interface CashEntry {
  id: string;
  account_id: string;
  account_name: string;
  amount: number;
  actor_name: string;
  business_date: string;
  note: string;
  reversal_of: string;
}
export interface Sale {
  id: string;
  number: string;
  actor_id: string;
  actor_name: string;
  customer_id: string;
  customer: CatalogEntry;
  department_name: string;
  salesperson_name: string;
  department_id?: string;
  salesperson_id?: string;
  type_id: string;
  type_name: string;
  billable: boolean;
  business_date: string;
  note: string;
  status: "draft" | "posted" | "voided";
  version: number;
  created_at: number;
  lines: SaleLine[];
  subtotal: number;
  discount_rate: number;
  discount: number;
  rounding: number;
  total: number;
  due: number;
  paid: number;
  debt: number;
  payments: CashEntry[];
  returned: Record<string, { quantity: number; credit: number }>;
  returns: {
    id: string;
    actor_name: string;
    reason: string;
    business_date: string;
    credit: number;
    lines: { item_id: string; quantity: number; credit: number }[];
  }[];
  attachments: {
    id: string;
    actor_name: string;
    mime: string;
    active: boolean;
  }[];
  revisions: {
    version: number;
    actor_name: string;
    reason: string;
    created_at: number;
  }[];
}
export interface Finance {
  performance: {
    department_id: string;
    department_name: string;
    salesperson_id: string;
    salesperson_name: string;
    count: number;
    due: number;
    paid: number;
    debt: number;
  }[];
  due: number;
  paid: number;
  debt: number;
  customers: {
    id: string;
    name: string;
    due: number;
    paid: number;
    debt: number;
  }[];
  accounts: {
    id: string;
    name: string;
    received: number;
    refunded: number;
    net: number;
  }[];
  entries: (CashEntry & { sale_id: string; number: string })[];
}
export function correctablePayments(sale: Sale) {
  return sale.payments.filter(
    (entry) =>
      !entry.reversal_of &&
      !sale.payments.some((reversal) => reversal.reversal_of === entry.id),
  );
}
export const moneyText = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const decimalText = (n: number, places: number) =>
  (n / 10 ** places).toFixed(places).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const saleStatus = (sale: Sale) =>
  `${{ draft: "草稿 · 未扣库存", posted: "已确认", voided: "已作废" }[sale.status]}${sale.status === "posted" && sale.billable ? ` · ${sale.paid === 0 && sale.debt > 0 ? "未收款" : sale.debt > 0 ? "部分收款" : "已结清"}` : ""}`;
// Exact BigInt preview follows the same rounding order as the server.
export function preview(input: SaleInput, billable: boolean) {
  const parse = (s: string, p: number) => {
    if (!/^\d+(\.\d+)?$/.test(s.trim())) throw new Error();
    const [w, f = ""] = s.trim().split(".");
    if (f.replace(/0+$/, "").length > p) throw new Error();
    return (
      BigInt(w) * 10n ** BigInt(p) +
      BigInt((f.slice(0, p) + "0".repeat(p)).slice(0, p) || "0")
    );
  };
  const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
  try {
    const amounts = input.lines.map((l) =>
      billable ? round(parse(l.quantity, 3) * parse(l.price, 4), 100000n) : 0n,
    );
    const subtotal = amounts.reduce((a, b) => a + b, 0n),
      rate = parse(input.discount_rate, 2),
      rounding = parse(input.rounding, 2);
    const discounted = round(subtotal * rate, 10000n),
      total = discounted - rounding;
    if (rate > 10000n || total < 0n || subtotal > 99999999999999n)
      return undefined;
    return {
      amounts: amounts.map(Number),
      subtotal: Number(subtotal),
      discount: Number(subtotal - discounted),
      rounding: Number(rounding),
      total: Number(total),
    };
  } catch {
    return undefined;
  }
}
