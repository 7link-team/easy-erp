export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        "X-ERP-Request": "1",
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      "无法连接库存电脑。已填写内容保留，请检查保存库存的电脑和网络后重试。",
      0,
    );
  }
  const data = await response
    .json()
    .catch(() => ({ error: "服务暂时无法完成操作，请稍后重试。" }));
  if (!response.ok) {
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("erp:unauthorized"));
    throw new ApiError(data.error ?? "操作失败，请重试。", response.status);
  }
  return data as T;
}

export const send = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body) });
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";

export interface User {
  id: string;
  username: string;
  name: string;
  role: "admin" | "worker" | "viewer";
  can_in: boolean;
  can_out: boolean;
  can_count: boolean;
  active: boolean;
}
export interface Item {
  id: string;
  code: string;
  name: string;
  spec: string;
  kind: string;
  unit: string;
  precision: number;
  barcode: string;
  minimum: number;
  balance: number;
  active: boolean;
  version: number;
  counting: boolean;
  can_delete: boolean;
}
export interface Line {
  item_id: string;
  name: string;
  unit: string;
  precision: number;
  quantity: number;
  delta: number;
  balance_after: number;
}
export interface Document {
  id: string;
  number: string;
  kind: string;
  actor_name: string;
  person: string;
  note: string;
  status: string;
  reference_id: string;
  created_at: number;
  lines: Line[];
}
export interface Audit {
  id: string;
  actor_name: string;
  action: string;
  object_id: string;
  created_at: number;
  details: unknown;
}
export interface Stocktake {
  id: string;
  status: string;
  note: string;
  created_at: number;
  lines: {
    item_id: string;
    code: string;
    name: string;
    unit: string;
    precision: number;
    expected: number;
    actual: number;
  }[];
}
export const kinds = ["原材料", "半成品", "成品", "辅料耗材", "其他"];
export const movementLabels: Record<string, string> = {
  receipt: "收货入库",
  finished: "完工入库",
  return_in: "退回入库",
  issue: "领用出库",
  shipment: "发货出库",
  return_out: "退回供应方",
  scrap: "报损出库",
  opening: "首次登记库存",
  void: "作废调整",
  adjustment: "清点调整",
};
export const quantity = (n: number, precision: number) =>
  (n / 1000).toFixed(precision);
export const dateTime = (n: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(n);
