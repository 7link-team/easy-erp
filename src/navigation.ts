import { useEffect, useRef, useState, type RefObject } from "react";
import type { Item } from "./api";
import { useConfirm } from "./ui";

const pages = [
  "home",
  "inventory",
  "sales",
  "returns",
  "finance",
  "customers",
  "catalog",
  "records",
  "stocktakes",
  "users",
  "settings",
  "updates",
  "in",
  "out",
] as const;
export type Page = (typeof pages)[number];
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
  async function navigate(page: Page, initialItem?: Item) {
    if (page === current.current.page && !initialItem) return;
    if (dirty.current && !(await leave())) return;
    const next = { page, initialItem, index: current.current.index + 1 };
    history.pushState({ erpRoute: next }, "", address(page));
    current.current = next;
    setRoute(next);
    window.scrollTo(0, 0);
    document.querySelector(".workspace")?.scrollTo(0, 0);
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
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
    );
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
