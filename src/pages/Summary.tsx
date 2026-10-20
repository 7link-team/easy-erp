import { useQueryValue } from "../navigation";
import { can, quantity, type User } from "../api";
import { Button, Input } from "../ui";
import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
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
  cost_price: number | null;
  in_quantity: number;
  in_value: string;
  out_quantity: number;
  out_value: string;
};
type Movements = {
  materials: Material[];
  in_value: string;
  out_value: string;
  stock_value: string;
  stock_unpriced: number;
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
  ["", "全部"],
  ["in", "入库"],
  ["out", "出库"],
  ["sales", "销售"],
] as const;

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
/** The current month, which is what a month-end check actually asks for. */
const monthStart = () => {
  const now = new Date();
  return stamp(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0));
};
const monthEnd = () => {
  const now = new Date();
  return stamp(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59));
};
const readable = (value: string) => value.replace("T", " ");
/** The periods an operator actually asks for, so the dates rarely need typing. */
const ranges: [string, () => [string, string]][] = [
  [
    "本月",
    () => {
      const now = new Date();
      return [
        stamp(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0)),
        stamp(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59)),
      ];
    },
  ],
  [
    "上月",
    () => {
      const now = new Date();
      return [
        stamp(new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0)),
        stamp(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59)),
      ];
    },
  ],
  [
    "近 7 天",
    () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return [
        stamp(
          new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate(),
            0,
            0,
          ),
        ),
        stamp(now),
      ];
    },
  ],
  [
    "近 30 天",
    () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return [
        stamp(
          new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate(),
            0,
            0,
          ),
        ),
        stamp(now),
      ];
    },
  ],
  [
    "今年",
    () => {
      const now = new Date();
      return [
        stamp(new Date(now.getFullYear(), 0, 1, 0, 0)),
        stamp(new Date(now.getFullYear(), 11, 31, 23, 59)),
      ];
    },
  ],
];
/** A cost carries four decimals but reads as money: keep at least two digits
 *  and drop only the zeros beyond them. */
const costText = (value: number) =>
  (value / 10000).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1");
/** A datetime field shows nothing for a date-only value, and an address may
 *  well carry one: the server accepts both forms. */
const forInput = (value: string, endOfDay: boolean) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59" : "00:00"}`
    : value;

/** Draw the figures as a picture, so a period can be sent on as one image.
 *  The columns follow whatever the page is showing: a direction that cannot
 *  have a figure contributes no empty column here either. */
function picture(
  rows: Material[],
  figures: [string, string][],
  title: string,
  period: string,
  showIncoming: boolean,
  showOutgoing: boolean,
) {
  type Column = { head: string; read: (row: Material) => string };
  const amounts: Column[] = [
    {
      head: "成本价",
      read: (row) =>
        row.cost_price === null ? "未定价" : `¥${costText(row.cost_price)}`,
    },
    ...(showIncoming
      ? [
          {
            head: "入库数量",
            read: (row: Material) =>
              row.in_quantity
                ? `${quantity(row.in_quantity, row.precision)} ${row.unit}`
                : "—",
          },
          {
            head: "入库金额",
            read: (row: Material) =>
              row.in_quantity ? `¥${row.in_value}` : "—",
          },
        ]
      : []),
    ...(showOutgoing
      ? [
          {
            head: "出库数量",
            read: (row: Material) =>
              row.out_quantity
                ? `${quantity(row.out_quantity, row.precision)} ${row.unit}`
                : "—",
          },
          {
            head: "出库金额",
            read: (row: Material) =>
              row.out_quantity ? `¥${row.out_value}` : "—",
          },
        ]
      : []),
  ];
  const scale = 2;
  const left = 28;
  const nameWidth = 200;
  const specWidth = 156;
  const amountWidth = 132;
  const width = left * 2 + nameWidth + specWidth + amounts.length * amountWidth;
  const step = 30;
  const top = 116;
  const height = top + (rows.length + 2) * step + 34 + figures.length * 25;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const pen = canvas.getContext("2d");
  if (!pen) return undefined;
  pen.scale(scale, scale);
  pen.fillStyle = "#ffffff";
  pen.fillRect(0, 0, width, height);
  const right = width - left;
  // Right edge of each amount column, laid out from the right so the money
  // lines up however many columns are showing.
  const edge = (index: number) =>
    right - (amounts.length - 1 - index) * amountWidth;
  const body = "15px system-ui, -apple-system, sans-serif";
  const bold = "600 15px system-ui, -apple-system, sans-serif";
  const put = (
    value: string,
    x: number,
    y: number,
    font: string,
    limit: number,
    end = false,
  ) => {
    pen.font = font;
    pen.textAlign = end ? "right" : "left";
    pen.fillText(value, x, y, limit);
  };
  pen.fillStyle = "#111827";
  put(
    title,
    left,
    46,
    "600 22px system-ui, -apple-system, sans-serif",
    width - left * 2,
  );
  pen.fillStyle = "#6b7280";
  put(period, left, 78, body, width - left * 2);
  pen.fillStyle = "#374151";
  put("物料", left, top, bold, nameWidth - 12);
  put("规格", left + nameWidth, top, bold, specWidth - 12);
  amounts.forEach((column, index) =>
    put(column.head, edge(index), top, bold, amountWidth - 12, true),
  );
  pen.strokeStyle = "#d1d5db";
  pen.beginPath();
  pen.moveTo(left, top + 11);
  pen.lineTo(right, top + 11);
  pen.stroke();
  pen.fillStyle = "#111827";
  rows.forEach((row, index) => {
    const y = top + 11 + (index + 1) * step;
    put(row.name, left, y, body, nameWidth - 12);
    put(row.spec, left + nameWidth, y, body, specWidth - 12);
    amounts.forEach((column, position) =>
      put(column.read(row), edge(position), y, body, amountWidth - 12, true),
    );
  });
  const end = top + 11 + (rows.length + 1) * step;
  pen.strokeStyle = "#9ca3af";
  pen.beginPath();
  pen.moveTo(left, end - 19);
  pen.lineTo(right, end - 19);
  pen.stroke();
  pen.fillStyle = "#111827";
  figures.forEach(([name, amount], index) => {
    const y = end + index * 25;
    put(name, left, y, bold, 420);
    put(amount, right, y, bold, 240, true);
  });
  return canvas.toDataURL("image/png");
}

export default function Summary({
  user,
  revision,
}: {
  user: User;
  revision: number;
}) {
  const stockAllowed = can(user, "records.read") && can(user, "items.read");
  const [direction, setDirection] = useQueryValue<string>(
    "summary_kind",
    stockAllowed ? "" : "sales",
  );
  const [team, setTeam] = useQueryValue<string>("summary_team", "");
  const [from, setFrom] = useQueryValue<string>("summary_from", monthStart());
  const [to, setTo] = useQueryValue<string>("summary_to", monthEnd());
  const [search, setSearch] = useQueryValue<string>("summary_q", "");
  const [query, setQuery] = useState(search);
  const [image, setImage] = useState<string>();
  const [drawFailed, setDrawFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const options = useResource<{
    items: { field: string; name: string; active?: boolean }[];
  }>(can(user, "options.read") ? "/material-options" : undefined, revision);
  const teams = (options.data?.items ?? [])
    .filter((option) => option.field === "team" && option.active !== false)
    .map((option) => option.name);
  const range = `q=${encodeURIComponent(query)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  // Every direction, sales included: a sales period still has to say which
  // materials left and what they cost, not only who bought them.
  const movements = useResource<Movements>(
    stockAllowed
      ? `/documents/summary?kind=${encodeURIComponent(direction)}&${range}&team=${encodeURIComponent(team)}`
      : undefined,
    revision,
  );
  // Revenue is the money a sale carries, not a cost, so it comes from its own
  // endpoint and is reported as its own figure rather than mixed in.
  const revenue = useResource<Revenue>(
    can(user, "sales.read") && direction !== "in" && direction !== "out"
      ? `/sales/summary?${range}`
      : undefined,
    revision,
  );
  const showIncoming = direction === "" || direction === "in";
  const label =
    directions.find(([value]) => value === direction)?.[1] ?? "全部";
  const period = `${readable(from) || "最早"} 至 ${readable(to) || "现在"}`;
  const loading = movements.loading || revenue.loading;
  const error = movements.error || revenue.error;
  // useResource keeps whatever it last loaded once its path becomes undefined,
  // so sales figures lingered after switching to a stock direction. What shows
  // follows the chosen direction, not whether data happens to be held.
  const showSales = direction === "" || direction === "sales";
  const showOutgoing = direction !== "in";
  const figures: [string, string][] = [];
  if (movements.data && showIncoming)
    figures.push(["入库成本总额", `¥${movements.data.in_value}`]);
  if (movements.data)
    figures.push(["当前库存成本总额", `¥${movements.data.stock_value}`]);
  if (movements.data && showOutgoing)
    figures.push(["出库成本总额", `¥${movements.data.out_value}`]);
  if (revenue.data && showSales)
    figures.push(["销售总额", `¥${revenue.data.total_amount}`]);
  const rows = movements.data?.materials ?? [];
  if (!stockAllowed && !can(user, "sales.read"))
    return <Empty>当前账号没有查看汇总的权限，请联系管理员。</Empty>;
  return (
    <div className="summary-page">
      <div className="page-heading">
        <div>
          <h1>汇总</h1>
          <p>
            按时间段统计每种物料的进出数量与金额。不同物料的数量和单价不相加，只合计金额。
          </p>
        </div>
        <div className="row-actions">
          <Button
            className="button"
            disabled={
              !rows.length && !(showSales && revenue.data?.customers.length)
            }
            onClick={() => {
              const drawn = picture(
                rows,
                figures,
                `${label}汇总`,
                period,
                showIncoming,
                showOutgoing,
              );
              if (drawn) setImage(drawn);
              else setDrawFailed(true);
            }}
          >
            <Download size={16} aria-hidden="true" />
            导出图片
          </Button>
        </div>
      </div>
      <section className="panel summary-filters" aria-label="汇总筛选">
        <div className="filters summary-search-row">
          <label className="search">
            <Search aria-hidden="true" size={18} />
            <Input
              aria-label="搜索汇总"
              name="summary-search"
              type="search"
              placeholder="物料、规格、单号、客户或小组…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Field label="开始时间">
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={forInput(from, false)}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
          </Field>
          <Field label="结束时间">
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={forInput(to, true)}
                onChange={(event) => setTo(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="filter-chips" role="group" aria-label="快捷时间段">
          <span className="summary-filter-label">时间范围</span>
          {ranges.map(([name, make]) => {
            const [start, end] = make();
            return (
              <Button
                key={name}
                className="filter-chip"
                aria-pressed={from === start && to === end}
                onClick={() => {
                  setFrom(start);
                  setTo(end);
                }}
              >
                {name}
              </Button>
            );
          })}
        </div>
        <div className="filter-chips" role="group" aria-label="统计方向">
          <span className="summary-filter-label">统计方向</span>
          {directions
            .filter(
              ([value]) =>
                (value !== "sales" || can(user, "sales.read")) &&
                (value === "sales" || stockAllowed),
            )
            .map(([value, name]) => (
              <Button
                key={value || "all"}
                className="filter-chip"
                aria-pressed={direction === value}
                onClick={() => setDirection(value)}
              >
                {name}
              </Button>
            ))}
        </div>
        {showIncoming && teams.length > 0 && (
          <div className="filter-chips" role="group" aria-label="入库小组">
            <span className="summary-filter-label">入库小组</span>
            {[
              ["", "全部小组"] as const,
              ...teams.map((n) => [n, n] as const),
            ].map(([value, name]) => (
              <Button
                key={value || "all"}
                className="filter-chip"
                aria-pressed={team === value}
                onClick={() => setTeam(value)}
              >
                {name}
              </Button>
            ))}
          </div>
        )}
      </section>
      <section className="summary-results" aria-label="统计结果">
        {error && <Notice>{error}</Notice>}
        {drawFailed && <Notice>这台设备无法生成图片，请直接截图表格。</Notice>}
        {loading && <Loading />}
        {!loading && !error && (
          <>
            <div className="summary-figures" aria-label="汇总金额">
              {figures.map(([name, amount]) => (
                <div className="summary-figure" key={name}>
                  <span>{name}</span>
                  <strong>{amount}</strong>
                  <small>
                    {name === "当前库存成本总额"
                      ? "实时库存快照"
                      : "所选期间累计"}
                  </small>
                </div>
              ))}
            </div>
            <div className="summary-context">
              <p className="hint">统计期间：{period}</p>
              {!!movements.data?.teams.length && (
                <div
                  className="summary-team-totals"
                  aria-label="各小组入库金额"
                >
                  <span>小组入库</span>
                  {movements.data.teams.map((entry) => (
                    <span key={entry.team}>
                      {entry.team || "未分小组"}
                      <strong>¥{entry.value}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {(movements.data?.unpriced_items ?? 0) > 0 && (
              <p className="hint">
                有 {movements.data?.unpriced_items}{" "}
                种物料未设置成本价，它们的金额按 0 计入。
              </p>
            )}
            {rows.length > 0 && (
              <TableScroll>
                <h2 className="summary-caption">
                  物料进出 <span>{rows.length} 种物料</span>
                </h2>
                <table aria-label="汇总列表" className="summary-table">
                  <thead>
                    <tr>
                      <th>物料 / 规格</th>
                      <th className="numeric">成本价（元）</th>
                      {showIncoming && (
                        <>
                          <th className="numeric">入库数量</th>
                          <th className="numeric">入库金额</th>
                        </>
                      )}
                      {showOutgoing && (
                        <>
                          <th className="numeric">出库数量</th>
                          <th className="numeric">出库金额</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.item_id}>
                        <td data-label="物料 / 规格">
                          <strong>{row.name}</strong>
                          <small>
                            {row.spec ? `${row.spec} · ` : ""}
                            {row.code}
                          </small>
                        </td>
                        <td className="numeric" data-label="成本价（元）">
                          {row.cost_price === null
                            ? "未设置"
                            : `¥${costText(row.cost_price)}`}
                        </td>
                        {showIncoming && (
                          <>
                            <td className="numeric" data-label="入库数量">
                              {row.in_quantity
                                ? `${quantity(row.in_quantity, row.precision)} ${row.unit}`
                                : "—"}
                            </td>
                            <td className="numeric" data-label="入库金额">
                              {row.in_quantity ? `¥${row.in_value}` : "—"}
                            </td>
                          </>
                        )}
                        {showOutgoing && (
                          <>
                            <td className="numeric" data-label="出库数量">
                              {row.out_quantity
                                ? `${quantity(row.out_quantity, row.precision)} ${row.unit}`
                                : "—"}
                            </td>
                            <td className="numeric" data-label="出库金额">
                              {row.out_quantity ? `¥${row.out_value}` : "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            {showSales && revenue.data && revenue.data.customers.length > 0 && (
              <TableScroll>
                <h2 className="summary-caption">
                  销售按客户{" "}
                  {/* 收款 reports the same customers by what they still owe,
                      so naming the measure keeps the two screens from looking
                      like they disagree. */}
                  <span>本期开单金额，不是欠款</span>
                </h2>
                <table aria-label="销售汇总列表" className="summary-table">
                  <thead>
                    <tr>
                      <th>客户</th>
                      <th className="numeric">单据数</th>
                      <th className="numeric">销售额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.data.customers.map((entry) => (
                      <tr key={entry.customer_id}>
                        <td data-label="客户">
                          <strong>{entry.name}</strong>
                        </td>
                        <td className="numeric" data-label="单据数">
                          {entry.count}
                        </td>
                        <td className="numeric" data-label="销售额">
                          ¥{entry.amount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            {rows.length === 0 &&
              !(showSales && revenue.data?.customers.length) && (
                <Empty>
                  这个时间段没有记录，调整时间、方向或关键词再看看。
                </Empty>
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
