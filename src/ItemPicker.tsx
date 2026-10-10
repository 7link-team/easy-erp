import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Button, Input } from "./ui";
import { Empty, Loading, Notice, useResource } from "./components";
import { quantity, type Item } from "./api";

export default function ItemPicker({
  id,
  describedBy,
  name,
  open,
  onOpenChange,
  onSelect,
  onCloseAutoFocus,
  selectedIds,
  allowZeroStock = false,
  searchLabel = "查找物料",
}: {
  id: string;
  describedBy?: string;
  name?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: Item) => void;
  onCloseAutoFocus: (event: Event) => void;
  selectedIds: string[];
  allowZeroStock?: boolean;
  searchLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [itemPage, setItemPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setItemPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const items = useResource<{ items: Item[]; total: number }>(
    open ? `/items?q=${encodeURIComponent(query)}&page=${itemPage}` : undefined,
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setSearch("");
          setItemPage(1);
        }
        onOpenChange(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          id={id}
          aria-label={name ? `更换物料：${name}` : "请选择物料"}
          className="button material-trigger"
          aria-describedby={describedBy}
        >
          <span>{name || "请选择物料"}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="material-menu"
          aria-label="选择物料"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <Input
              aria-label={searchLabel}
              name="sale-item-search"
              type="search"
              autoComplete="off"
              placeholder="名称、编码或条码，例如 M6…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {items.error && <Notice>{items.error}</Notice>}
          <div
            className="material-picker"
            aria-busy={items.loading || search !== query}
          >
            {items.loading || search !== query ? (
              <Loading />
            ) : (
              items.data?.items.map((item) => {
                const added = selectedIds.includes(item.id);
                const unavailable = !allowZeroStock && item.balance <= 0;
                const label = added
                  ? "已添加"
                  : item.counting
                    ? "正在清点"
                    : unavailable
                      ? "无库存"
                      : "选择";
                return (
                  <div
                    className="material-picker-row"
                    key={item.id}
                    data-added={added}
                    data-unavailable={unavailable}
                  >
                    <div className="material-picker-info">
                      <strong>{item.name}</strong>
                      <small>
                        {[item.spec, item.code].filter(Boolean).join(" · ")}
                      </small>
                    </div>
                    <span className="material-picker-stock">
                      库存 {quantity(item.balance, item.precision)} {item.unit}
                    </span>
                    <Button
                      className="button small material-picker-add"
                      aria-label={`${label}${item.name}`}
                      disabled={item.counting || added || unavailable}
                      onClick={() => onSelect(item)}
                    >
                      {added ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        !item.counting &&
                        !unavailable && <Plus size={16} aria-hidden="true" />
                      )}
                      {label}
                    </Button>
                  </div>
                );
              })
            )}
            {!items.loading &&
              search === query &&
              !items.error &&
              !items.data?.items.length && (
                <Empty>没有找到物料，请换个关键词。</Empty>
              )}
          </div>
          {(items.data?.total ?? 0) > 50 && (
            <div className="pagination">
              <span>
                第 {itemPage} 页 · 共 {items.data?.total} 种
              </span>
              <div>
                <Button
                  className="button small"
                  disabled={itemPage === 1 || items.loading || search !== query}
                  onClick={() => setItemPage((n) => n - 1)}
                >
                  上一页物料
                </Button>
                <Button
                  className="button small"
                  disabled={
                    itemPage * 50 >= (items.data?.total ?? 0) ||
                    items.loading ||
                    search !== query
                  }
                  onClick={() => setItemPage((n) => n + 1)}
                >
                  下一页物料
                </Button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
