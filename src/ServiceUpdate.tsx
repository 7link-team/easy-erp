import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "./api";
import { Button } from "./ui";

/** A shared server can change while a browser is still running its old frontend. */
export function ServiceUpdate({ dirty }: { dirty: RefObject<boolean> }) {
  const initial = useRef<string | undefined>(undefined);
  const [version, setVersion] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const status = await api<{ version: string }>("/status");
        if (stopped) return;
        if (!initial.current) initial.current = status.version;
        else if (status.version !== initial.current) setVersion(status.version);
      } catch {
        /* The service may be restarting; keep the current form intact. */
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5 * 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  if (!version) return null;
  return (
    <div className="service-update" role="status">
      <span>
        库存服务已更新至 {version}，刷新后使用新版界面。{message}
      </span>
      <Button
        onClick={() => {
          if (dirty.current) {
            setMessage("请先完成或取消未提交的收发内容。");
            return;
          }
          location.reload();
        }}
      >
        刷新页面
      </Button>
    </div>
  );
}
