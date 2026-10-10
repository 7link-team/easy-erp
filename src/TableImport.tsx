import { useState } from "react";
import { api, send } from "./api";
import { Form, Select, Input, Button } from "./ui";
import {
  TableScroll,
  Field,
  Notice,
  Submit,
  form,
  useAction,
} from "./components";

interface Preview {
  id: string;
  headers: string[];
  rows: string[][];
  errors: string[];
}

export default function TableImport({
  onImported,
  onClose,
  mode: fixedMode,
}: {
  onImported: () => void;
  onClose?: () => void;
  mode?: string;
}) {
  const action = useAction();
  const [message, setMessage] = useState("");
  const [selectedMode, setMode] = useState("items");
  const mode = fixedMode ?? selectedMode;
  const inventory = mode === "items" || mode === "opening";
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  return (
    <>
      {action.error && <Notice>{action.error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      <p>
        {inventory
          ? "先导入物料资料，再导入第一次使用时的库存数量。已有库存记录不能重新登记初始数量，请使用清点库存。"
          : "按模板填写新资料，先预览检查，再确认整批导入。同名记录不会被覆盖；任何一行有误，整批都不会保存。"}
        {!inventory &&
          !["spec", "kind", "unit"].includes(mode) &&
          " 状态填写启用或停用（空白默认启用），排序可填0–9999（空白默认0）。"}
        {mode === "type" && " 是否计款必须填写是或否。"}
        {mode === "salesperson" &&
          " 请先维护部门，再填写已启用部门的完整名称。"}
      </p>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              if (!file) throw new Error("请先选择 .xlsx 或 CSV 文件。");
              const body = new FormData();
              body.append("file", file);
              setPreview(
                await api<Preview>(`/imports/${mode}/preview`, {
                  method: "POST",
                  body,
                }),
              );
            }),
          )
        }
      >
        {!fixedMode && (
          <Field label="导入内容" required>
            {(p) => (
              <Select
                {...p}
                disabled={action.busy}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setPreview(undefined);
                  setMessage("");
                }}
              >
                <option value="items">物料资料</option>
                <option value="opening">首次登记的库存数量</option>
              </Select>
            )}
          </Field>
        )}
        <div className="row-actions import-templates">
          <a
            className="button small"
            href={`/api/templates/${mode}?format=xlsx`}
          >
            下载 Excel 模板
          </a>
          <a
            className="button small"
            href={`/api/templates/${mode}?format=csv`}
          >
            下载 CSV 模板
          </a>
        </div>
        <Field
          label="选择表格文件"
          required
          hint={`支持 .xlsx、UTF-8 CSV，最大 5 MB，每次 1–100 行。${inventory ? "不会直接覆盖已有库存。" : "请将电话等编号列设为文本，保留前导零。"}`}
        >
          {(p) => (
            <label className="file-picker" htmlFor={p.id}>
              <span className="button">选择文件</span>
              <span className="file-picker-name" role="status">
                {file?.name ?? "未选择文件"}
              </span>
              <Input
                {...p}
                type="file"
                disabled={action.busy}
                accept=".xlsx,.csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  setPreview(undefined);
                  setMessage("");
                }}
              />
            </label>
          )}
        </Field>
        {!preview && (
          <div className="form-actions form-footer">
            {onClose && (
              <Button onClick={onClose}>{message ? "完成" : "取消"}</Button>
            )}
            <Submit busy={action.busy}>预览并检查文件</Submit>
          </div>
        )}
      </Form>
      {preview && (
        <div className="section-divider">
          <h3>导入预览 · {preview.rows.length} 行</h3>
          {preview.errors.length ? (
            <Notice>
              <strong>
                有 {preview.errors.length} 处需要修改，尚未导入任何数据。
              </strong>
              <ul>
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice success>文件检查通过。确认后才会保存到库存电脑。</Notice>
          )}
          <TableScroll>
            <table>
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 10).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {preview.rows.length > 10 && (
            <p className="hint">
              预览显示前 10 行，确认将导入全部 {preview.rows.length} 行。
            </p>
          )}
          <div className="form-actions form-footer">
            {onClose && <Button onClick={onClose}>取消</Button>}
            <Button
              className="button primary"
              disabled={action.busy || preview.errors.length > 0}
              onClick={() =>
                action.run(async () => {
                  await send(`/imports/${preview.id}/commit`, {});
                  setMessage(`已导入 ${preview.rows.length} 行数据。`);
                  setPreview(undefined);
                  onImported();
                })
              }
            >
              确认导入 {preview.rows.length} 行
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
