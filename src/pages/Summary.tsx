import { useQueryValue } from "../navigation";
import { can, quantity, type User } from "../api";
import { Button, Input, Select } from "../ui";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  Empty,
  Field,
  Loading,
  Modal,
  Notice,
  TableScroll,
  useResource,
} from "../components";

type Material = {
  item_id: string;
  name: string;
  code: string;
  spec: string;
  unit: string;
  precision: number;
  quantity: number;
  value: string | null;
};
type Totals = {
  materials: Material[];
  total_value: string;
  unpriced_items: number;
  teams: { team: string; value: string }[];
};
type Revenue = {
  customers: {
    customer_id: string;
    name: string;
    count: number;
    amount: string;
  }[];
  total_amount: string;
  count: number;
};

const directions = [
  ["in", "入库"],
  ["out", "出库"],
  ["sales", "销售"],
] as const;

/** One shape for the table and the picture, whichever direction is showing. */
type Row = {
  key: string;
  name: string;
  detail: string;
  measure: string;
  amount: string | null;
};
type View = {
  columns: [string, string, string, string];
  rows: Row[];
  total: string;
  notes: string[];
  detailed: boolean;
};

/** Lay a view out as a picture, so a period can be sent on as one image. */
function picture(view: View, title: string, period: string) {
  const scale = 2;
  const width = 760;
  const step = 30;
  const top = 104;
  const height =
    top + (view.rows.length + 2) * step + 28 + view.notes.length * 24;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const pen = canvas.getContext("2d");
  if (!pen) return undefined;
  pen.scale(scale, scale);
  pen.fillStyle = "#ffffff";
  pen.fillRect(0, 0, width, height);
  const at = [24, 300, 580, 736];
  const body = "15px system-ui, -apple-system, sans-serif";
  const bold = "600 15px system-ui, -apple-system, sans-serif";
  // Each column gets a width budget: a long material name would otherwise run
  // straight through the next column instead of being squeezed to fit.
  const widths = [264, 268, 140, 148];
  const write = (
    value: string,
    column: number,
    y: number,
    font: string,
    right = false,
  ) => {
    pen.font = font;
    pen.textAlign = right ? "right" : "left";
    pen.fillText(value, at[column], y, widths[column]);
  };
  pen.fillStyle = "#111827";
  pen.font = "600 21px system-ui, -apple-system, sans-serif";
  pen.textAlign = "left";
  pen.fillText(title, at[0], 44, width - 48);
  pen.fillStyle = "#6b7280";
  pen.font = body;
  pen.fillText(period, at[0], 74, width - 48);
  pen.fillStyle = "#374151";
  write(view.columns[0], 0, top, bold);
  if (view.detailed) write(view.columns[1], 1, top, bold);
  write(view.columns[2], 2, top, bold, true);
  write(view.columns[3], 3, top, bold, true);
  pen.strokeStyle = "#d1d5db";
  pen.beginPath();
  pen.moveTo(at[0], top + 10);
  pen.lineTo(at[3], top + 10);
  pen.stroke();
  pen.fillStyle = "#111827";
  view.rows.forEach((row, index) => {
    const y = top + 10 + (index + 1) * step;
    write(row.name, 0, y, body);
    if (view.detailed) write(row.detail, 1, y, body);
    write(row.measure, 2, y, body, true);
    write(row.amount ?? "未定价", 3, y, body, true);
  });
  const end = top + 10 + (view.rows.length + 1) * step;
  pen.strokeStyle = "#9ca3af";
  pen.beginPath();
  pen.moveTo(at[0], end - 18);
  pen.lineTo(at[3], end - 18);
  pen.stroke();
  write("合计金额", 0, end, bold);
  write(`¥${view.total}`, 3, end, bold, true);
  pen.fillStyle = "#6b7280";
  pen.font = body;
  pen.textAlign = "left";
  view.notes.forEach((note, index) =>
    pen.fillText(note, at[0], end + 26 + index * 24, width - 48),
  );
  return canvas.toDataURL("image/png");
}

export default function Summary({
  user,
  revision,
}: {
  user: User;
  revision: number;
}) {
  // A sales-only account cannot use the stock directions, and defaulting to
  // one left it looking at an empty page with a blank direction box.
  const stockAllowed = can(user, "records.read") && can(user, "items.read");
  const [direction, setDirection] = useQueryValue<string>(
    "summary_kind",
    stockAllowed ? "in" : "sales",
  );
  const [team, setTeam] = useQueryValue<string>("summary_team", "");
  const [from, setFrom] = useQueryValue<string>("summary_from", "");
  const [to, setTo] = useQueryValue<string>("summary_to", "");
  const [search, setSearch] = useQueryValue<string>("summary_q", "");
  const [query, setQuery] = useState(search);
  const [image, setImage] = useState<string>();
  const [drawFailed, setDrawFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const sales = direction === "sales";
  const options = useResource<{
    items: { field: string; name: string; active?: boolean }[];
  }>(
    can(user, "options.read") && !sales ? "/material-options" : undefined,
    revision,
  );
  const teams = (options.data?.items ?? [])
    .filter((option) => option.field === "team" && option.active !== false)
    .map((option) => option.name);
  const period = `${from || "最早"} 至 ${to || "今天"}`;
  const range = `q=${encodeURIComponent(query)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const stock = useResource<Totals>(
    stockAllowed && !sales
      ? `/documents/summary?kind=${encodeURIComponent(direction)}&${range}&team=${encodeURIComponent(team)}`
      : undefined,
    revision,
  );
  const revenue = useResource<Revenue>(
    can(user, "sales.read") && sales ? `/sales/summary?${range}` : undefined,
    revision,
  );
  const label =
    directions.find(([value]) => value === direction)?.[1] ?? "入库";
  const active = sales ? revenue : stock;
  let view: View | undefined;
  if (sales && revenue.data) {
    view = {
      columns: ["客户", "", "单据数", "销售额"],
      detailed: false,
      rows: revenue.data.customers.map((entry) => ({
        key: entry.customer_id,
        name: entry.name,
        detail: "",
        measure: `${entry.count} 单`,
        amount: entry.amount,
      })),
      total: revenue.data.total_amount,
      notes: [`共 ${revenue.data.count} 张已过账单据。`],
    };
  } else if (!sales && stock.data) {
    view = {
      columns: ["物料", "规格", "数量", "金额"],
      detailed: true,
      rows: stock.data.materials.map((material) => ({
        key: material.item_id,
        name: material.name,
        detail: material.spec,
        measure: `${quantity(material.quantity, material.precision)} ${material.unit}`,
        amount: material.value,
      })),
      total: stock.data.total_value,
      notes: [
        ...(stock.data.teams.length
          ? [
              stock.data.teams
                .map((entry) => `${entry.team || "未分小组"} ¥${entry.value}`)
                .join(" · "),
            ]
          : []),
        ...(stock.data.unpriced_items > 0
          ? [
              `另有 ${stock.data.unpriced_items} 种物料未设置成本价，未计入合计金额。`,
            ]
          : []),
      ],
    };
  }
  if (!stockAllowed && !can(user, "sales.read"))
    return <Empty>当前账号没有查看汇总的权限，请联系管理员。</Empty>;
  return (
    <div>
      <div className="page-heading">
        <div>
          <h1>汇总</h1>
          <p>
            按时间段统计入库、出库或销售，逐行列出并给出合计金额。不同物料的数量和单价不相加。
          </p>
        </div>
        <div className="row-actions">
          <Button
            className="button"
            disabled={!view?.rows.length}
            onClick={() => {
              if (!view) return;
              const drawn = picture(view, `${label}汇总`, period);
              // A browser that refuses a 2D context would otherwise leave the
              // button looking broken.
              if (drawn) setImage(drawn);
              else setDrawFailed(true);
            }}
          >
            导出图片
          </Button>
        </div>
      </div>
      <section className="panel">
        <div className="filters">
          <label className="search">
            <Search aria-hidden="true" size={18} />
            <Input
              aria-label="搜索汇总"
              name="summary-search"
              type="search"
              placeholder={sales ? "客户或单号…" : "物料、规格、单号或小组…"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Field label="方向">
            {(p) => (
              <Select
                {...p}
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
              >
                {directions
                  .filter(([value]) =>
                    value === "sales" ? can(user, "sales.read") : stockAllowed,
                  )
                  .map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="日期从">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
          </Field>
          <Field label="日期到">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            )}
          </Field>
          {direction === "in" && teams.length > 0 && (
            <Field label="小组">
              {(p) => (
                <Select
                  {...p}
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                >
                  <option value="">全部小组</option>
                  {teams.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        {active.error && <Notice>{active.error}</Notice>}
        {drawFailed && <Notice>这台设备无法生成图片，请直接截图表格。</Notice>}
        {active.loading && <Loading />}
        {view && !active.loading && (
          <>
            <p className="dictionary-feedback">
              {label}合计金额：<strong>¥{view.total}</strong>（{period}
              {sales ? "，按已过账单据金额" : "，按当前成本价计算"}）
            </p>
            {view.notes.map((note) => (
              <p className="hint" key={note}>
                {note}
              </p>
            ))}
            {view.rows.length === 0 ? (
              <Empty>这个时间段没有记录，调整日期、方向或关键词再看看。</Empty>
            ) : (
              <TableScroll>
                <table aria-label="汇总列表">
                  <thead>
                    <tr>
                      <th>{view.columns[0]}</th>
                      {view.detailed && <th>{view.columns[1]}</th>}
                      <th className="numeric">{view.columns[2]}</th>
                      <th className="numeric">{view.columns[3]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.key}>
                        <td data-label={view.columns[0]}>
                          <strong>{row.name}</strong>
                        </td>
                        {view.detailed && (
                          <td data-label={view.columns[1]}>{row.detail}</td>
                        )}
                        <td className="numeric" data-label={view.columns[2]}>
                          {row.measure}
                        </td>
                        <td className="numeric" data-label={view.columns[3]}>
                          {row.amount ? `¥${row.amount}` : "未定价"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </>
        )}
      </section>
      {image && (
        <Modal title={`${label}汇总图片`} onClose={() => setImage(undefined)}>
          <p className="hint">长按或右键可保存图片，也可以直接截图发出去。</p>
          <img className="summary-picture" src={image} alt={`${label}汇总`} />
          <p>
            <a className="button" href={image} download={`${label}汇总.png`}>
              保存图片
            </a>
          </p>
        </Modal>
      )}
    </div>
  );
}
