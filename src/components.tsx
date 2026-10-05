import { Button } from "./ui";
import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  useContext,
  type ReactNode,
  type FormEvent,
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
export { Modal } from "./ui";

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
          <HelpCircle size={17} />
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
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
  help?: string;
}) {
  const id = useId();
  const errors = useContext(ValidationContext);
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>
          {label} <span>{required ? "必填" : "选填"}</span>
        </label>
      </div>
      {children({
        id,
        "aria-describedby":
          [hint ? `${id}-hint` : "", errors[id] ? `${id}-error` : ""]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {errors[id] && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {errors[id]}
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
      {success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
      <div>{children}</div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty" role="status">
      <LoaderCircle className="spin" size={24} /> 正在读取…
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
      {busy && <LoaderCircle size={18} className="spin" />}
      {busy ? "正在保存…" : children}
    </Button>
  );
}
export function useResource<T>(path: string, revision = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then(setData)
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
