import { Button } from "./ui";
import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  useContext,
  useSyncExternalStore,
  type ReactNode,
  type FormEvent,
  type AnchorHTMLAttributes,
} from "react";
import {
  HelpCircle,
  X,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { api, errorText } from "./api";
import { ValidationContext } from "./ui";
import * as Popover from "@radix-ui/react-popover";
import { pageAddress, type Navigate, type Page } from "./navigation";
export { Modal } from "./ui";

const subscribeQuery = (notify: () => void) => {
  window.addEventListener("erp:querychange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("erp:querychange", notify);
    window.removeEventListener("popstate", notify);
  };
};
const querySnapshot = () => location.search;

export function PageLink({
  page,
  query,
  navigate,
  className = "",
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  page: Page;
  query?: Record<string, string>;
  navigate: Navigate;
}) {
  useSyncExternalStore(subscribeQuery, querySnapshot);
  return (
    <a
      {...props}
      href={pageAddress(page, query)}
      className={`ui-button page-link ${className}`}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (props.target && props.target !== "_self")
        )
          return;
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        void navigate(page, undefined, query);
      }}
    />
  );
}

export function TableScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () =>
      setOverflowing(container.scrollWidth > container.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (container.firstElementChild)
      observer.observe(container.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {overflowing && (
        <p className="table-hint" id={id}>
          左右滚动表格可查看全部列；键盘可用左右方向键。
        </p>
      )}
      <div
        ref={ref}
        className="table-wrap"
        role={overflowing ? "region" : undefined}
        aria-label={overflowing ? "可横向滚动的数据表格" : undefined}
        aria-describedby={overflowing ? id : undefined}
        tabIndex={overflowing ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !overflowing) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.currentTarget.scrollLeft +=
              event.key === "ArrowRight" ? 80 : -80;
          }
        }}
      >
        {children}
      </div>
    </>
  );
}

export function Help({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button className="ui-help-trigger" aria-label={`关于${title}`}>
          <HelpCircle aria-hidden="true" size={17} />
          <span>填写说明</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-help-content"
          sideOffset={6}
          collisionPadding={16}
          role="note"
        >
          <strong>{title}</strong>
          <p>{children}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function Field({
  label,
  hint,
  required,
  children,
  help,
  error,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    required?: boolean;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
  help?: string;
  error?: string;
}) {
  const id = useId();
  const errors = useContext(ValidationContext);
  const message = error || errors[id];
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>
          {label}{" "}
          {required ? <span className="sr-only">必填</span> : <span>选填</span>}
        </label>
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </div>
      {children({
        id,
        name: label,
        required,
        "aria-invalid": !!message || undefined,
        "aria-describedby":
          [hint ? `${id}-hint` : "", message ? `${id}-error` : ""]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {message && (
        <p
          className="field-error"
          id={`${id}-error`}
          role={error ? undefined : "alert"}
          aria-live={error ? "polite" : undefined}
        >
          {message}
        </p>
      )}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {help && <Help title={label}>{help}</Help>}
    </div>
  );
}
export function Notice({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`notice ${success ? "success" : "error"}`}
      role={success ? "status" : "alert"}
    >
      {success ? (
        <CheckCircle2 aria-hidden="true" size={20} />
      ) : (
        <AlertCircle aria-hidden="true" size={20} />
      )}
      <div>{children}</div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty" role="status">
      <LoaderCircle aria-hidden="true" className="spin" size={24} /> 正在读取…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <Button className="button primary" type="submit" disabled={busy}>
      {busy && <LoaderCircle aria-hidden="true" size={18} className="spin" />}
      {busy ? "正在保存…" : children}
    </Button>
  );
}
export function useResource<T>(path: string | undefined, revision = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading };
}
export function useAction() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return { error, busy, run, setError };
}
export const form = (e: FormEvent, action: () => void) => {
  e.preventDefault();
  action();
};

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="recovery">
        <Notice>页面遇到问题，已保存的数据不受影响。请重新打开页面。</Notice>
        <Button className="button" onClick={() => location.reload()}>
          重新打开
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
