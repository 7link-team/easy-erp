import { Fragment, type ReactNode } from "react";
import { dateTime, movementLabels, quantity } from "./api";

const labels: Record<string, string> = {
  name: "名称",
  number: "记录号",
  kind: "类型",
  role: "角色",
  active: "允许使用",
  can_in: "允许入库",
  can_out: "允许出库",
  can_count: "允许填写清点",
  reason: "原因",
  note: "备注",
  before: "修改前",
  lines: "物料明细",
  code: "物料编码",
  spec: "规格",
  unit: "单位",
  precision: "小数位数",
  barcode: "条码",
  balance: "库存数量",
  minimum: "最低库存",
  quantity: "本次数量",
  balance_after: "操作后的库存",
  count: "数量",
  rows: "表格行数",
  format: "文件格式",
  size: "备份大小",
  enabled: "开启自动备份",
  interval: "备份频率",
  hour: "每日备份时间",
  keep_daily: "每日备份保留份数",
  keep_weekly: "每周备份保留份数",
  restore_point: "恢复到的时间",
  before_backup: "恢复前备份文件",
  counting: "正在清点",
};
const names: Record<string, string> = {
  ...movementLabels,
  admin: "管理员",
  worker: "操作员",
  viewer: "查看员",
  daily: "每天一次",
  hourly: "每小时一次",
};

function display(
  value: unknown,
  key: string,
  record: Record<string, unknown>,
): ReactNode {
  if (value === null || value === "") return "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    if (key === "size") return `${Math.ceil(value / 1024)} KB`;
    if (key === "hour") return `${String(value).padStart(2, "0")}:00`;
    if (key === "restore_point") return dateTime(value);
    if (["balance", "minimum", "quantity", "balance_after"].includes(key)) {
      if (key === "minimum" && value < 0) return "不提醒";
      return `${quantity(value, typeof record.precision === "number" ? record.precision : 3)} ${record.unit ?? ""}`;
    }
    return value;
  }
  if (typeof value === "string")
    return ["role", "kind", "interval"].includes(key)
      ? (names[value] ?? value)
      : value;
  if (Array.isArray(value))
    return value.map((item, i) => (
      <div className="audit-line" key={i}>
        <AuditDetails value={item} />
      </div>
    ));
  if (typeof value === "object") return <AuditDetails value={value} />;
  return "未填写";
}

export function AuditDetails({ value }: { value: unknown }) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields = Object.entries(record).filter(([key]) => key in labels);
  return fields.length ? (
    <dl className="audit-fields">
      {fields.map(([key, item]) => (
        <Fragment key={key}>
          <dt>{labels[key]}</dt>
          <dd>{display(item, key, record)}</dd>
        </Fragment>
      ))}
    </dl>
  ) : (
    <p className="hint">本次操作没有补充说明。</p>
  );
}
