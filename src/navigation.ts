import { useEffect, useRef, useState, type RefObject } from "react";
import type { Item } from "./api";
import { useConfirm } from "./ui";

const pages = [
  "home",
  "inventory",
  "invoice",
  "sales",
  "returns",
  "finance",
  "accounts",
  "performance",
  "customers",
  "catalog",
  "records",
  "movement",
  "stocktakes",
  "users",
  "settings",
  "updates",
  "in",
  "out",
] as const;
export type Page = (typeof pages)[number];
export type Navigate = (
  page: Page,
  initialItem?: Item,
  query?: Record<string, string>,
) => Promise<boolean>;
interface Route {
  page: Page;
  index: number;
  initialItem?: Item;
}
const hashPage = (): Page => {
  const candidate = location.hash.replace(/^#\/?/, "");
  return pages.includes(candidate as Page) ? (candidate as Page) : "home";
};
const address = (page: Page) =>
  `${location.pathname}${location.search}#/${page}`;

/** Share the same query cleanup between in-app navigation and native links. */
export function pageAddress(page: Page, query?: Record<string, string>) {
  const params = new URLSearchParams(location.search);
  if (!query?.sale_open) params.delete("sale_open");
  if (!query?.sale_print) params.delete("sale_print");
  if (page !== "inventory") params.delete("inventory_item");
  if (page !== "customers") params.delete("customer_focus");
  // Search/dashboard links target documents unless a record filter is explicit.
  if (page === "sales" && query && !query.sales_records)
    params.delete("sales_records");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}#/${page}`;
}

/** Keep app navigation and browser Back in the same history, including form guards. */
export function useNavigation(dirty: RefObject<boolean>) {
  const confirm = useConfirm();
  const leave = () =>
    confirm({
      title: "离开当前页面？",
      description: "还有未提交的内容，离开后这些内容不会保存。",
      confirmLabel: "确认离开",
    });
  const [route, setRoute] = useState<Route>(() => ({
    page: hashPage(),
    index: 0,
  }));
  const current = useRef(route);
  useEffect(() => {
    history.replaceState(
      { erpRoute: current.current },
      "",
      address(current.current.page),
    );
    let restoring = false;
    const pop = async (event: PopStateEvent) => {
      const target: Route = event.state?.erpRoute ?? {
        page: hashPage(),
        index: 0,
      };
      if (!restoring && dirty.current && !(await leave())) {
        const offset = current.current.index - target.index;
        if (offset) {
          restoring = true;
          history.go(offset);
        } else
          history.pushState(
            { erpRoute: current.current },
            "",
            address(current.current.page),
          );
        return;
      }
      restoring = false;
      current.current = target;
      setRoute(target);
      window.scrollTo(0, 0);
      document.querySelector(".workspace")?.scrollTo(0, 0);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty]);
  async function navigate(
    page: Page,
    initialItem?: Item,
    query?: Record<string, string>,
  ) {
    if (page === current.current.page && !initialItem && !query) return true;
    if (dirty.current && !(await leave())) return false;
    const next = { page, initialItem, index: current.current.index + 1 };
    history.pushState({ erpRoute: next }, "", pageAddress(page, query));
    current.current = next;
    setRoute(next);
    window.scrollTo(0, 0);
    document.querySelector(".workspace")?.scrollTo(0, 0);
    return true;
  }
  function reset() {
    const next: Route = { page: "home", index: current.current.index };
    history.replaceState({ erpRoute: next }, "", address("home"));
    current.current = next;
    setRoute(next);
  }
  const back = () =>
    current.current.index > 0 ? history.back() : navigate("home");
  return { route, navigate, back, reset };
}

/** Keep ledger filters in shareable URLs without adding navigation entries per keystroke. */
export function useQueryValue<T extends string | number>(
  key: string,
  fallback: T,
) {
  const read = () => {
    const raw = new URLSearchParams(location.search).get(key);
    if (raw === null) return fallback;
    return (
      typeof fallback === "number"
        ? /^\d+$/.test(raw) &&
          Number.isSafeInteger(Number(raw)) &&
          Number(raw) > 0
          ? Number(raw)
          : fallback
        : raw
    ) as T;
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (value === fallback) params.delete(key);
    else params.set(key, String(value));
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) {
      history.replaceState(history.state, "", next);
      window.dispatchEvent(new Event("erp:querychange"));
    }
  }, [key, value, fallback]);
  useEffect(() => {
    const restore = () => setValue(read());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key, fallback]);
  return [value, setValue] as const;
}

/** iOS overlays its keyboard; keep sheets/actions inside the visible viewport. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.documentElement;
        const inset = Math.max(
          0,
          innerHeight - viewport.height - viewport.offsetTop,
        );
        root.style.setProperty("--viewport-height", `${viewport.height}px`);
        root.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        root.dataset.keyboard = inset > 120 ? "open" : "closed";
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
}
