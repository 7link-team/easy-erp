import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "./ui";
import { Empty, Loading, Notice, TableScroll, useResource } from "./components";
import { can, type User } from "./api";
import { moneyText } from "./sales";
import {
  useQueryValue,
  pageAddress,
  type Navigate,
  type Page,
} from "./navigation";

function HomeLink({
  page,
  query,
  navigate,
  className,
  children,
}: {
  page: Page;
  query?: Record<string, string>;
  navigate: Navigate;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={pageAddress(page, query)}
      className={`ui-button home-link ${className}`}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        void navigate(page, undefined, query);
      }}
    >
      {children}
    </a>
  );
}

interface Overview {
  today: string;
  month_start: string;
  previous_start: string;
  previous_to: string;
  time_zone: string;
  inventory?: { total: number; stocked: number; low: number; zero: number };
  stocktake?: { counted: number; differences: number };
  aged_debt?: { count: number; debt: number };
  performance?: {
    total: number;
    items: { department: string; salesperson: string; due: number }[];
  };
  records?: { total: number; all: boolean };
  finance?: {
    due: number;
    paid: number;
    debt: number;
    comparison_due: number;
    daily: { date: string; due: number }[];
  };
  sales?: {
    total: number;
    all_count: number;
    due: number;
    paid: number;
    debt: number;
    posted: number;
    all: boolean;
    types: { id: string; name: string; count: number }[];
    items: {
      id: string;
      number: string;
      customer: string;
      type_name: string;
      actor_name: string;
      department_name: string;
      salesperson_name: string;
      status: string;
      billable: boolean;
      due: number;
      paid: number;
      debt: number;
    }[];
  };
}
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(
    new Date(`${day}T12:00:00`),
  );
const percent = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);

export function useOverview(revision: number) {
  const [type, setType] = useQueryValue<string>("home_type", "");
  const resource = useResource<Overview>(
    `/dashboard?type_id=${encodeURIComponent(type)}`,
    revision,
  );
  return { ...resource, type, setType };
}

export function HomeMetrics({
  overview,
  navigate,
}: {
  overview: ReturnType<typeof useOverview>;
  navigate: Navigate;
}) {
  const { data, loading, error } = overview;
  const [showDaily, setShowDaily] = useState(false);
  const finance = data?.finance;
  const activeDay = finance?.daily.at(-1);
  const maximum = Math.max(1, ...(finance?.daily.map((d) => d.due) ?? []));
  return (
    <>
      {error && <Notice>{error}</Notice>}
      {loading && !data && <Loading />}
      {finance && (
        <section className="business-band" aria-label="本月经营概况">
          <div className="business-band-grid">
            <div>
              <p className="business-period">
                {data.month_start} — {data.today}
              </p>
              <h2>本月单据当前应收</h2>
              <div className="business-figure">
                <small>¥</small>
                {moneyText(finance.due)}
              </div>
              <p className="business-comparison">
                上月同期应收 ¥{moneyText(finance.comparison_due)}
                <span className="business-comparison-period">
                  （{data.previous_start} — {data.previous_to}）
                </span>
              </p>
            </div>
            <dl className="business-balances">
              <div>
                <dt>单据净实收</dt>
                <dd>¥{moneyText(finance.paid)}</dd>
              </div>
              <div>
                <dt>剩余欠款</dt>
                <dd className={finance.debt > 0 ? "owe" : ""}>
                  ¥{moneyText(finance.debt)}
                </dd>
              </div>
              <div>
                <dt>已收比例</dt>
                <dd>
                  {finance.due ? percent(finance.paid / finance.due) : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <p className="business-basis">
            按业务日期归属，扣除退货、排除草稿与作废；收款为这些单据截至当前的净实收。
          </p>
          <div className="business-chart-head">
            <span>近 30 日每日应收</span>
            <span>
              {activeDay &&
                `${dayLabel(activeDay.date)} · ¥${moneyText(activeDay.due)}`}
            </span>
          </div>
          <div
            className="business-chart"
            role="img"
            aria-label="近30日每日应收柱状图；各日金额可通过下方按钮查看"
          >
            {finance.daily.map((day) => (
              <span
                key={day.date}
                className={`business-day${day.date === data.today ? " current" : ""}`}
                title={`${day.date} 应收 ¥${moneyText(day.due)}`}
                aria-hidden="true"
              >
                <span style={{ height: `${(day.due / maximum) * 100}%` }} />
              </span>
            ))}
          </div>
          <div className="business-chart-foot">
            <span>{dayLabel(finance.daily[0].date)}</span>
            <Button
              className="text-button"
              aria-expanded={showDaily}
              onClick={() => setShowDaily((v) => !v)}
            >
              {showDaily ? "收起每日金额" : "查看每日金额"}
            </Button>
            <span>{dayLabel(data.today)}</span>
          </div>
          {showDaily && (
            <div
              className="daily-amounts"
              role="list"
              aria-label="每日应收明细"
            >
              {finance.daily.map((day) => (
                <div role="listitem" key={day.date}>
                  <span>{day.date}</span>
                  <strong>¥{moneyText(day.due)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {data && (
        <div className="home-ledger" aria-label="库存与清点概况">
          {data.inventory && (
            <>
              <HomeLink
                className="home-ledger-cell"
                page="inventory"
                navigate={navigate}
                query={{
                  inventory_q: "",
                  inventory_kind: "",
                  inventory_status: "active",
                  inventory_sort: "name",
                  inventory_page: "",
                }}
              >
                <span>在用物料</span>
                <strong>
                  {data.inventory.total.toLocaleString()}
                  <small>种</small>
                </strong>
                <small>
                  有库存 {data.inventory.stocked.toLocaleString()} 种
                </small>
                <ChevronRight size={16} aria-hidden="true" />
              </HomeLink>
              <HomeLink
                className="home-ledger-cell"
                page="inventory"
                navigate={navigate}
                query={{
                  inventory_q: "",
                  inventory_kind: "",
                  inventory_status: "low",
                  inventory_sort: "name",
                  inventory_page: "",
                }}
              >
                <span>库存不足</span>
                <strong className={data.inventory.low ? "warning-number" : ""}>
                  {data.inventory.low.toLocaleString()}
                  <small>种</small>
                </strong>
                <small>
                  当前零库存 {data.inventory.zero.toLocaleString()} 种
                </small>
                <ChevronRight size={16} aria-hidden="true" />
              </HomeLink>
            </>
          )}
          {data.records && (
            <HomeLink
              className="home-ledger-cell"
              page="records"
              navigate={navigate}
            >
              <span>
                {data.records.all ? "今日库存操作" : "本人今日库存操作"}
              </span>
              <strong>
                {data.records.total.toLocaleString()}
                <small>笔</small>
              </strong>
              <small>含销售与调整 · 主机时区 {data.time_zone}</small>
              <ChevronRight size={16} aria-hidden="true" />
            </HomeLink>
          )}
          {data.stocktake && data.inventory && (
            <HomeLink
              className="home-ledger-cell"
              page="stocktakes"
              navigate={navigate}
            >
              <span>本月清点进度</span>
              <strong>
                {data.inventory.total
                  ? percent(data.stocktake.counted / data.inventory.total)
                  : "—"}
              </strong>
              <small>
                已确认 {data.stocktake.counted} / {data.inventory.total} 种 ·{" "}
                {data.stocktake.differences} 种有差异
              </small>
              <progress
                aria-label="本月已确认清点比例"
                max={data.inventory.total || 1}
                value={data.stocktake.counted}
              />
              <ChevronRight size={16} aria-hidden="true" />
            </HomeLink>
          )}
        </div>
      )}
    </>
  );
}

export function TodaySales({
  overview,
  user,
  navigate,
}: {
  overview: ReturnType<typeof useOverview>;
  user: User;
  navigate: Navigate;
}) {
  const { data, loading, error, type, setType } = overview;
  if (!can(user, "sales.read")) return null;
  const sales = data?.sales;
  return (
    <section className="panel ledger-sheet today-sales">
      <div className="ledger-heading section-title">
        <h2>{sales?.all ? "今日单据" : "本人今日单据"}</h2>
        {data && (
          <HomeLink
            className="text-button"
            page="sales"
            navigate={navigate}
            query={{
              sales_from: data.today,
              sales_to: data.today,
              sales_status: "",
              sales_q: "",
              sales_page: "",
              sale_open: "",
              sale_print: "",
            }}
          >
            查看今日全部单据 →
          </HomeLink>
        )}
      </div>
      <div className="filter-chips" role="group" aria-label="今日单据类型">
        <Button
          className="filter-chip"
          aria-pressed={!type}
          onClick={() => setType("")}
        >
          全部 <span>{sales?.all_count ?? "…"}</span>
        </Button>
        {sales?.types.map((t) => (
          <Button
            key={t.id}
            className="filter-chip"
            aria-pressed={type === t.id}
            onClick={() => setType(t.id)}
          >
            {t.name} <span>{t.count}</span>
          </Button>
        ))}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>今日单据未加载，请刷新重试。</Empty>
      ) : sales?.items.length ? (
        <TableScroll>
          <table className="today-sales-table" aria-label="今日销售单据">
            <thead>
              <tr>
                <th scope="col">单号 / 类型</th>
                <th scope="col">客户 / 业绩归属</th>
                <th scope="col" className="numeric">
                  应收 / 净实收
                </th>
                <th scope="col">状态</th>
                <th scope="col" className="ledger-actions">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.items.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <HomeLink
                      className="record-link"
                      page="sales"
                      navigate={navigate}
                      query={{ sale_open: sale.id, sale_print: "" }}
                    >
                      <strong>{sale.number}</strong>
                      <small>
                        {sale.type_name} · {sale.actor_name}
                      </small>
                    </HomeLink>
                  </td>
                  <td data-label="客户 / 业绩归属">
                    <strong>{sale.customer}</strong>
                    <small>
                      {sale.department_name || "未指定部门"} ·{" "}
                      {sale.salesperson_name || "未指定业务员"}
                    </small>
                  </td>
                  <td className="numeric" data-label="应收 / 净实收">
                    {sale.status === "posted" && sale.billable ? (
                      <>
                        <strong>¥{moneyText(sale.due)}</strong>
                        <small>净实收 ¥{moneyText(sale.paid)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="状态">
                    <span
                      className={`badge ${sale.status === "posted" ? (sale.debt > 0 ? "amber" : "green") : ""}`}
                    >
                      {sale.status === "draft"
                        ? "草稿 · 未记账"
                        : sale.status === "voided"
                          ? "已作废"
                          : !sale.billable
                            ? "不计款"
                            : sale.debt > 0
                              ? `欠 ¥${moneyText(sale.debt)}`
                              : "已结清"}
                    </span>
                  </td>
                  <td className="document-row-actions" data-label="操作">
                    <HomeLink
                      className="button small"
                      page="sales"
                      navigate={navigate}
                      query={{ sale_open: sale.id, sale_print: "" }}
                    >
                      查看
                    </HomeLink>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>本日合计 · {sales.posted} 张有效单据</td>
                <td className="numeric">
                  <strong>应收 ¥{moneyText(sales.due)}</strong>
                  <small>净实收 ¥{moneyText(sales.paid)}</small>
                </td>
                <td colSpan={2}>欠款 ¥{moneyText(sales.debt)}</td>
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      ) : (
        <Empty>{type ? "今天没有该类型的单据。" : "今天还没有单据。"}</Empty>
      )}
      {!!sales && (
        <p className="home-ledger-note">
          业务日期 {data.today} · 共 {sales.total} 张
          {sales.total > 6 ? "，显示最近 6 张" : ""}
        </p>
      )}
    </section>
  );
}

export function HomeFollowUp({
  overview,
  navigate,
}: {
  overview: ReturnType<typeof useOverview>;
  navigate: Navigate;
}) {
  const data = overview.data;
  if (!data) return null;
  const remaining =
    data.inventory && data.stocktake
      ? data.inventory.total - data.stocktake.counted
      : 0;
  const relevant = !!(data.inventory || data.stocktake || data.aged_debt);
  const hasReminders = !!(
    data.inventory?.zero ||
    data.aged_debt?.count ||
    remaining
  );
  const maximum = Math.max(
    1,
    ...(data.performance?.items.map((p) => p.due) ?? []),
  );
  return (
    <aside className="home-follow-up">
      {relevant && (
        <section className="panel ledger-sheet">
          <div className="section-title ledger-heading">
            <h2>需要处理</h2>
          </div>
          {!hasReminders && <Empty>当前可查看范围内暂无待处理提醒。</Empty>}
          {!!data.inventory?.zero && (
            <HomeLink
              className="home-reminder"
              page="inventory"
              navigate={navigate}
              query={{
                inventory_status: "zero",
                inventory_q: "",
                inventory_kind: "",
                inventory_page: "",
              }}
            >
              <strong>{data.inventory.zero} 种物料库存为零</strong>
              <small>查看物料，按实际到货登记入库。</small>
              <ChevronRight size={16} aria-hidden="true" />
            </HomeLink>
          )}
          {!!data.aged_debt?.count && (
            <HomeLink
              className="home-reminder"
              page="finance"
              navigate={navigate}
            >
              <strong>
                {data.aged_debt.count} 笔单据开单超过 60 天仍有欠款
              </strong>
              <small>
                当前合计 ¥{moneyText(data.aged_debt.debt)} · 从业务日期计算
              </small>
              <ChevronRight size={16} aria-hidden="true" />
            </HomeLink>
          )}
          {remaining > 0 && (
            <HomeLink
              className="home-reminder"
              page="stocktakes"
              navigate={navigate}
            >
              <strong>本月还有 {remaining} 种物料未完成清点</strong>
              <small>仅统计已确认的清点，同一物料重复清点算一次。</small>
              <ChevronRight size={16} aria-hidden="true" />
            </HomeLink>
          )}
        </section>
      )}
      {data.performance && (
        <section className="panel ledger-sheet">
          <div className="section-title ledger-heading">
            <h2>本月业务员业绩</h2>
          </div>
          <p className="home-ledger-note">
            按当前应收排序
            {data.performance.total > 5
              ? ` · 前 5 / ${data.performance.total} 组`
              : ""}
          </p>
          {data.performance.items.length ? (
            <div className="home-performance">
              {data.performance.items.map((p, i) => (
                <div key={i} className="home-performance-row">
                  <span>
                    <strong>{p.salesperson || "未指定业务员"}</strong>
                    <small>{p.department || "未指定部门"}</small>
                  </span>
                  <span className="home-performance-track" aria-hidden="true">
                    <i style={{ width: `${(p.due / maximum) * 100}%` }} />
                  </span>
                  <strong className="numeric">¥{moneyText(p.due)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty>本月暂无计款单据。</Empty>
          )}
        </section>
      )}
    </aside>
  );
}
