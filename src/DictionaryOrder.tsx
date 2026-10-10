import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { send } from "./api";
import { useAction } from "./components";
import { Button } from "./ui";

type Entry = { id: string; name: string; version: number };
const dragType = "application/x-erp-dictionary-entry";

export function useDictionaryOrder(
  rows: Entry[],
  kind: string,
  loading: boolean,
  allowed: boolean,
  refresh: () => void,
) {
  const action = useAction();
  const [dragged, setDragged] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef<{ id: string; version: number } | null>(null);
  const busy = action.busy || loading;
  useEffect(() => {
    const previous = pending.current;
    if (
      loading ||
      !previous ||
      !rows.some((r) => r.id === previous.id && r.version !== previous.version)
    )
      return;
    document
      .querySelector<HTMLButtonElement>(
        `[data-order-id="${CSS.escape(previous.id)}"] button:not(:disabled)`,
      )
      ?.focus();
    pending.current = null;
  }, [rows, loading]);
  useEffect(() => {
    setMessage("");
    action.setError("");
    pending.current = null;
  }, [kind]);
  const move = (entry: Entry, to: number, focus: boolean) => {
    const from = rows.findIndex((r) => r.id === entry.id);
    if (
      !allowed ||
      busy ||
      from < 0 ||
      from === to ||
      to < 0 ||
      to >= rows.length
    )
      return;
    const reordered = [...rows];
    reordered.splice(from, 1);
    reordered.splice(to, 0, entry);
    void action.run(async () => {
      await send("/catalog-order", {
        kind,
        entries: reordered.map(({ id, version }) => ({ id, version })),
      });
      if (focus) pending.current = { id: entry.id, version: entry.version };
      setMessage(`已将“${entry.name}”移至第 ${to + 1} 项。`);
      refresh();
    });
  };
  const drop = (event: DragEvent<HTMLTableRowElement>, target: Entry) => {
    const id = event.dataTransfer.getData(dragType);
    const entry = rows.find((r) => r.id === id);
    if (!entry) return;
    event.preventDefault();
    setDragged("");
    move(
      entry,
      rows.findIndex((r) => r.id === target.id),
      false,
    );
  };
  return {
    error: action.error,
    message,
    busy,
    rowProps: (entry: Entry) => ({
      "data-order-dragging": dragged === entry.id || undefined,
      onDragOver: (event: DragEvent<HTMLTableRowElement>) => {
        if (allowed && !busy && event.dataTransfer.types.includes(dragType)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: (event: DragEvent<HTMLTableRowElement>) => drop(event, entry),
    }),
    controls: (entry: Entry, index: number) =>
      allowed ? (
        <div className="dictionary-order" data-order-id={entry.id}>
          <span
            className="dictionary-grip"
            draggable={!busy}
            aria-hidden="true"
            title="拖动调整顺序"
            onDragStart={(event) => {
              event.dataTransfer.setData(dragType, entry.id);
              event.dataTransfer.effectAllowed = "move";
              setDragged(entry.id);
            }}
            onDragEnd={() => setDragged("")}
          >
            <GripVertical size={16} />
          </span>
          <span className="dictionary-position">{index + 1}</span>
          <Button
            className="icon-button"
            aria-label={`上移${entry.name}`}
            title="上移"
            disabled={busy || index === 0}
            onClick={() => move(entry, index - 1, true)}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </Button>
          <Button
            className="icon-button"
            aria-label={`下移${entry.name}`}
            title="下移"
            disabled={busy || index === rows.length - 1}
            onClick={() => move(entry, index + 1, true)}
          >
            <ArrowDown size={14} aria-hidden="true" />
          </Button>
        </div>
      ) : (
        index + 1
      ),
  };
}
