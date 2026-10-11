import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { can, quantity, type Item, type User } from "./api";
import { Button, Input, Modal } from "./ui";
import { Empty, Loading, Notice, useAction, useResource } from "./components";
import { pageAddress, type Navigate, type Page } from "./navigation";
import type { CatalogEntry, Sale } from "./sales";

type Results<T> = { items: T[]; total: number };

function SearchResults({
  query,
  user,
  revision,
  navigate,
  onClose,
}: {
  query: string;
  user: User;
  revision: number;
  navigate: Navigate;
  onClose: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const action = useAction();
  const encoded = encodeURIComponent(query);
  const materials = useResource<Results<Item>>(
    can(user, "items.read") ? `/items?q=${encoded}&sort=name` : undefined,
    revision + retry,
  );
  const sales = useResource<Results<Sale>>(
    can(user, "sales.read") ? `/sales?q=${encoded}` : undefined,
    revision + retry,
  );
  const customers = useResource<Results<CatalogEntry>>(
    can(user, "customers.read")
      ? `/sales/catalog?kind=customer&q=${encoded}`
      : undefined,
    revision + retry,
  );
  function link(
    page: Page,
    params: Record<string, string>,
    children: ReactNode,
  ) {
    return (
      <a
        className="global-search-result"
        href={pageAddress(page, params)}
        aria-disabled={action.busy || undefined}
        data-search-result
        onClick={(event) => {
          if (action.busy) {
            event.preventDefault();
            return;
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          void action.run(async () => {
            if (await navigate(page, undefined, params)) onClose();
          });
        }}
      >
        {children}
      </a>
    );
  }
  function group<T extends { id: string }>(
    title: string,
    resource: ReturnType<typeof useResource<Results<T>>>,
    render: (item: T) => ReactNode,
    all: ReactNode,
  ) {
    return (
      <section className="global-search-group" aria-label={`${title}搜索结果`}>
        <h3>
          {title}
          <span>
            {resource.loading || resource.error
              ? "…"
              : (resource.data?.total ?? 0)}
          </span>
        </h3>
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <>
            <Notice>{resource.error}</Notice>
            <Button onClick={() => setRetry((v) => v + 1)}>
              重新搜索{title}
            </Button>
          </>
        ) : resource.data?.items.length ? (
          <>
            <ul>
              {resource.data.items.slice(0, 6).map((item) => (
                <li key={item.id}>{render(item)}</li>
              ))}
            </ul>
            {resource.data.total > 6 && all}
          </>
        ) : (
          <p className="muted">没有匹配的{title}。</p>
        )}
      </section>
    );
  }
  const inventoryQuery = {
    inventory_q: query,
    inventory_kind: "",
    inventory_status: "active",
    inventory_sort: "name",
    inventory_page: "",
    inventory_item: "",
  };
  const customerQuery = {
    customer_q: query,
    customer_focus: "",
    customer_ledger: "",
  };
  return (
    <div className="global-search-results" aria-busy={action.busy}>
      {action.error && <Notice>{action.error}</Notice>}
      {can(user, "items.read") &&
        group(
          "物料",
          materials,
          (item) =>
            link(
              "inventory",
              { ...inventoryQuery, inventory_q: "", inventory_item: item.id },
              <>
                <strong>{item.name}</strong>
                <small>
                  {[item.code, item.spec].filter(Boolean).join(" · ") ||
                    "未填写编码或规格"}
                </small>
                <span>
                  库存 {quantity(item.balance, item.precision)} {item.unit}
                </span>
              </>,
            ),
          link("inventory", inventoryQuery, <>查看全部匹配物料 →</>),
        )}
      {can(user, "sales.read") &&
        group(
          "单据",
          sales,
          (sale) =>
            link(
              "sales",
              { sale_open: sale.id },
              <>
                <strong>{sale.number}</strong>
                <small>
                  {sale.type_name} · {sale.customer.name} · {sale.business_date}
                </small>
                <span>
                  {sale.status === "draft"
                    ? "草稿"
                    : sale.status === "voided"
                      ? "已作废"
                      : "已确认"}
                </span>
              </>,
            ),
          link(
            "sales",
            {
              sales_q: query,
              sales_status: "",
              sales_from: "",
              sales_to: "",
              sales_page: "",
            },
            <>查看全部匹配单据 →</>,
          ),
        )}
      {can(user, "customers.read") &&
        group(
          "客户",
          customers,
          (customer) =>
            link(
              "customers",
              { ...customerQuery, customer_focus: customer.id },
              <>
                <strong>
                  {customer.name}
                  {!customer.active && "（已停用）"}
                </strong>
                <small>
                  {[customer.data.contact, customer.data.phone]
                    .filter(Boolean)
                    .join(" · ") || "未填写联系人或电话"}
                </small>
                {customer.data.address && <span>{customer.data.address}</span>}
              </>,
            ),
          link("customers", customerQuery, <>查看全部匹配客户 →</>),
        )}
    </div>
  );
}

export function GlobalSearch({
  user,
  revision,
  navigate,
}: {
  user: User;
  revision: number;
  navigate: Navigate;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const allowed = ["items.read", "sales.read", "customers.read"].some((p) =>
    can(user, p),
  );
  useEffect(() => {
    if (!allowed) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [allowed]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  if (!allowed) return null;
  return (
    <>
      <Button
        className="global-search-trigger"
        aria-label="全局搜索物料、单号或客户"
        title="全局搜索（Ctrl / ⌘ K）"
        aria-keyshortcuts="Control+k Meta+k"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Search size={18} aria-hidden="true" />
        <span>搜物料、单号、客户</span>
        <kbd aria-hidden="true">
          {navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}K
        </kbd>
      </Button>
      {open && (
        <Modal title="全局搜索" onClose={() => setOpen(false)}>
          <div
            className="global-search"
            onKeyDown={(event) => {
              if (
                !["ArrowDown", "ArrowUp"].includes(event.key) ||
                event.nativeEvent.isComposing
              )
                return;
              const links = Array.from(
                event.currentTarget.querySelectorAll<HTMLAnchorElement>(
                  "a[data-search-result]",
                ),
              );
              const input = event.currentTarget.querySelector("input");
              const current = links.indexOf(
                document.activeElement as HTMLAnchorElement,
              );
              if (document.activeElement !== input && current < 0) return;
              if (!links.length) return;
              event.preventDefault();
              if (event.key === "ArrowUp" && current <= 0) input?.focus();
              else
                links[
                  Math.min(
                    links.length - 1,
                    current + (event.key === "ArrowDown" ? 1 : -1),
                  )
                ]?.focus();
            }}
          >
            <label className="search">
              <Search size={18} aria-hidden="true" />
              <Input
                type="search"
                autoFocus={window.matchMedia("(pointer: fine)").matches}
                name="global-search"
                aria-label="搜索物料、单号或客户"
                placeholder="例如物料编码、单号、客户姓名或电话…"
                autoComplete="off"
                spellCheck={false}
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <p className="muted">
              输入关键词，选择结果打开。
              <span className="global-search-keyboard">
                ↑ ↓ 切换，Enter 打开，Esc 关闭。
              </span>
            </p>
            {!search.trim() ? (
              <Empty>搜索有权查看的在用物料、销售单据和客户资料。</Empty>
            ) : search.trim() !== query ? (
              <Loading />
            ) : (
              <SearchResults
                key={query}
                query={query}
                user={user}
                revision={revision}
                navigate={navigate}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
