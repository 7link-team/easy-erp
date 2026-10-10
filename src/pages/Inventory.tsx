import { useQueryValue } from "../navigation";
import { can } from "../api";
import { Disclosure } from "../ui";
import { Form, Input, Select, ComboBox, Button, useConfirm } from "../ui";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  ReceiptText,
} from "lucide-react";
import { type Item, type User, api, send, kinds, quantity } from "../api";
import {
  Empty,
  TableScroll,
  Field,
  Loading,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

export function ItemForm({
  item,
  onDone,
  onClose,
}: {
  item?: Item;
  onDone: () => void;
  onClose: () => void;
}) {
  const choices = useResource<{ items: { field: string; name: string }[] }>(
    "/material-options",
  );
  const options = (field: string) =>
    (choices.data?.items || [])
      .filter((c) => c.field === field)
      .map((c) => ({ value: c.name, label: c.name }));
  const [name, setName] = useState(item?.name ?? "");
  const [spec, setSpec] = useState(item?.spec ?? "");
  const [kind, setKind] = useState(item?.kind ?? "其他");
  const [unit, setUnit] = useState(item?.unit ?? "个");
  const precision = item?.precision ?? 3;
  const [code, setCode] = useState(item?.code ?? "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [minimum, setMinimum] = useState(
    item && item.minimum >= 0 ? quantity(item.minimum, item.precision) : "",
  );
  const action = useAction();
  return (
    <Modal title={item ? "修改物料" : "添加物料"} onClose={onClose}>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              await send(
                item ? `/items/${item.id}` : "/items",
                {
                  name,
                  spec,
                  kind,
                  unit,
                  precision,
                  code,
                  barcode,
                  minimum: minimum || null,
                  version: item?.version,
                },
                item ? "PUT" : "POST",
              );
              onDone();
            }),
          )
        }
      >
        <Field
          label="物料名称"
          required
          hint="填写大家熟悉的名字，例如：镀锌螺丝。"
        >
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoFocus
            />
          )}
        </Field>
        <div className="form-grid">
          <Field label="规格" hint="例如：M6 × 20 mm">
            {(p) => (
              <ComboBox
                {...p}
                options={options("spec")}
                value={spec}
                onValueChange={setSpec}
                maxLength={100}
              />
            )}
          </Field>
          <Field
            label="物料类型"
            help="只用于分类查找，不会自动扣原料或增加成品数量。"
          >
            {(p) => (
              <ComboBox
                {...p}
                options={options("kind")}
                value={kind}
                onValueChange={setKind}
                maxLength={100}
              />
            )}
          </Field>
        </div>
        <div className="form-grid">
          <Field label="基本单位" required hint="已有出入库记录后不能更改。">
            {(p) => (
              <ComboBox
                {...p}
                options={options("unit")}
                value={unit}
                onValueChange={setUnit}
                required
                maxLength={16}
              />
            )}
          </Field>
          <p className="muted">
            数量支持整数和最多 3 位小数，例如
            10、1.25。库存数量在入库或首次库存登记时填写。
          </p>
        </div>
        <Field label="最低库存提醒" hint="留空不提醒；填 0 表示用完时提醒。">
          {(p) => (
            <Input
              {...p}
              inputMode={precision ? "decimal" : "numeric"}
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
          )}
        </Field>
        <Disclosure className="more" title="更多选项：物料编码、条码">
          <Field
            label="物料编码"
            hint="留空自动编号；原有表格有编码可直接填写。"
          >
            {(p) => (
              <Input
                {...p}
                maxLength={64}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Field label="条码" hint="没有条码可以不填。">
            {(p) => (
              <Input
                {...p}
                maxLength={128}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            )}
          </Field>
        </Disclosure>
        {action.error && <Notice>{action.error}</Notice>}
        <div className="form-actions form-footer">
          <Button type="button" className="button" onClick={onClose}>
            取消
          </Button>
          <Submit busy={action.busy}>保存物料</Submit>
        </div>
      </Form>
    </Modal>
  );
}

export default function Inventory({
  user,
  revision,
  refresh,
  move,
  openSale,
}: {
  user: User;
  revision: number;
  refresh: () => void;
  move: (direction: "in" | "out", item?: Item) => void;
  openSale: (item: Item) => void;
}) {
  const choices = useResource<{
    items: { field: string; name: string }[];
    kinds: string[];
  }>("/material-options", revision);
  const typeOptions = Array.from(
    new Set([
      ...kinds,
      ...(choices.data?.kinds || []),
      ...(choices.data?.items || [])
        .filter((c) => c.field === "kind")
        .map((c) => c.name),
    ]),
  );
  const [search, setSearch] = useQueryValue<string>("inventory_q", "");
  const [debounced, setDebounced] = useState(search);
  const [kind, setKind] = useQueryValue<string>("inventory_kind", "");
  const [status, setStatus] = useQueryValue<string>(
    "inventory_status",
    "active",
  );
  const [sort, setSort] = useQueryValue<string>("inventory_sort", "newest");
  const confirm = useConfirm();
  const [page, setPage] = useQueryValue<number>("inventory_page", 1);
  const [editing, setEditing] = useState<Item | "new">();
  const [removing, setRemoving] = useState<Item>();
  const action = useAction();
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, error, loading } = useResource<{
    items: Item[];
    total: number;
    counts: Record<string, number>;
  }>(
    `/items?q=${encodeURIComponent(debounced)}&kind=${encodeURIComponent(kind)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}&page=${page}`,
    revision,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>物料</h1>
          <p>找物料、看数量。每笔收发都有记录。</p>
        </div>
        <div className="row-actions">
          {user.role === "admin" && (
            <a
              className="button"
              href={`/api/export/items?format=csv&q=${encodeURIComponent(debounced)}&kind=${encodeURIComponent(kind)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}`}
            >
              导出 CSV
            </a>
          )}
          {can(user, "items.create") && (
            <Button
              className="button primary"
              onClick={() => setEditing("new")}
            >
              <Plus size={19} />
              添加物料
            </Button>
          )}
        </div>
      </div>
      <section className="panel ledger-sheet inventory-sheet">
        <div className="filters">
          <label className="search">
            <Search size={20} />
            <Input
              aria-label="搜索物料"
              name="inventory-search"
              type="search"
              placeholder="名称、规格、编码或条码…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <Select
            aria-label="筛选物料类型"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部类型</option>
            {typeOptions.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <Select
            aria-label="物料排序"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="newest">最近新增</option>
            <option value="stock_asc">库存量从少到多</option>
            <option value="stock_desc">库存量从多到少</option>
            <option value="name">物料名称</option>
          </Select>
        </div>
        <div className="filter-chips" role="group" aria-label="物料状态">
          {[
            ["active", "全部在用"],
            ["low", "低库存"],
            ["zero", "已清零"],
            ["archived", "已停用"],
          ].map(([value, label]) => (
            <Button
              key={value}
              className="filter-chip"
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}{" "}
              <span aria-hidden="true">
                {data?.counts?.[value]?.toLocaleString() ?? "…"}
              </span>
            </Button>
          ))}
        </div>
        {(error || action.error) && <Notice>{error || action.error}</Notice>}
        {loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>
            {search || kind || status !== "active"
              ? "没有符合筛选条件的物料，请调整搜索或状态。"
              : "暂无物料，请管理员添加或导入物料。"}
          </Empty>
        ) : (
          <TableScroll>
            <table
              className="inventory-table"
              role="table"
              aria-label="物料库存"
            >
              <thead role="rowgroup">
                <tr>
                  <th>物料 / 规格</th>
                  <th>类型</th>
                  <th className="numeric">当前库存</th>
                  <th className="numeric">预警线</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.items.map((item) => (
                  <tr key={item.id} role="row">
                    <td role="cell">
                      <strong>{item.name}</strong>
                      <small>
                        {item.spec || "未填写规格"} · {item.code}
                      </small>
                    </td>
                    <td role="cell">{item.kind}</td>
                    <td className="numeric" role="cell">
                      <b className="stock-number">
                        {quantity(item.balance, item.precision)}
                      </b>{" "}
                      {item.unit}
                    </td>
                    <td className="numeric" role="cell" data-label="预警线">
                      {item.minimum >= 0
                        ? `${quantity(item.minimum, item.precision)} ${item.unit}`
                        : "未设置"}
                    </td>
                    <td role="cell">
                      {!item.active ? (
                        <span className="badge">已停用</span>
                      ) : item.counting ? (
                        <span className="badge amber">正在清点</span>
                      ) : item.minimum >= 0 && item.balance <= item.minimum ? (
                        <span className="badge amber">库存不足</span>
                      ) : (
                        <span className="badge">正常</span>
                      )}
                    </td>
                    <td role="cell">
                      <div className="row-actions">
                        {item.active && can(user, "movement.in") && (
                          <Button
                            className="button small"
                            disabled={item.counting}
                            onClick={() => move("in", item)}
                          >
                            <ArrowDownToLine size={16} />
                            入库
                          </Button>
                        )}
                        {item.active && can(user, "movement.out") && (
                          <Button
                            className="button small"
                            disabled={item.counting || item.balance <= 0}
                            title={
                              item.balance <= 0
                                ? "无库存，暂不能出库"
                                : undefined
                            }
                            onClick={() => move("out", item)}
                          >
                            <ArrowUpFromLine size={16} />
                            出库
                          </Button>
                        )}
                        {item.active && can(user, "sales.create") && (
                          <Button
                            className="button small"
                            disabled={item.counting || item.balance <= 0}
                            title={
                              item.balance <= 0
                                ? "无库存，暂不能开单出库"
                                : undefined
                            }
                            onClick={() => openSale(item)}
                          >
                            <ReceiptText size={16} />
                            开单出库
                          </Button>
                        )}
                        {can(user, "items.update") && (
                          <Button
                            className="icon-button"
                            onClick={() => setEditing(item)}
                            aria-label={`修改${item.name}`}
                          >
                            <Pencil size={17} />
                          </Button>
                        )}
                        {!item.active && can(user, "items.update") && (
                          <Button
                            className="button small"
                            disabled={action.busy}
                            onClick={() =>
                              action.run(async () => {
                                if (
                                  !(await confirm({
                                    title: `启用“${item.name}”？`,
                                    description:
                                      "启用后可以重新登记收发，原库存和历史记录保留。",
                                    confirmLabel: "确认启用",
                                  }))
                                )
                                  return;
                                await send(`/items/${item.id}/restore`, {
                                  version: item.version,
                                });
                                refresh();
                              })
                            }
                          >
                            启用
                          </Button>
                        )}
                        {item.active &&
                          can(user, "items.delete") &&
                          item.balance === 0 &&
                          !item.counting && (
                            <Button
                              className={`button small ${item.can_delete ? "danger-outline" : ""}`}
                              onClick={() => {
                                action.setError("");
                                setRemoving(item);
                              }}
                            >
                              {item.can_delete ? "删除" : "停用"}
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <div className="pagination">
          <span>
            共 {data?.total ?? 0} 件物料 · 第 {page} 页
          </span>
          <div>
            <Button
              className="button small"
              disabled={page === 1 || loading || search !== debounced}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              className="button small"
              disabled={
                loading ||
                search !== debounced ||
                page * 50 >= (data?.total ?? 0)
              }
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
      {editing && (
        <ItemForm
          item={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
      {removing && (
        <Modal
          title={removing.can_delete ? "删除物料" : "停用物料"}
          onClose={() => {
            if (!action.busy) setRemoving(undefined);
          }}
        >
          <p>
            <strong>{removing.name}</strong> · {removing.spec || "未填写规格"} ·{" "}
            {removing.code}
          </p>
          <p>
            {removing.can_delete
              ? "这件物料没有库存和业务记录。删除后将从物料列表移除，不能撤销；删除操作仍会记录。"
              : "这件物料库存为 0，但有历史记录。停用后不再出现在收发列表中，历史记录保留。"}
          </p>
          {action.error && <Notice>{action.error}</Notice>}
          <div className="form-actions">
            <Button
              autoFocus
              disabled={action.busy}
              onClick={() => setRemoving(undefined)}
            >
              取消
            </Button>
            <Button
              className="button danger"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await send(
                    `/items/${removing.id}${removing.can_delete ? "/permanent" : ""}`,
                    {},
                    "DELETE",
                  );
                  setRemoving(undefined);
                  refresh();
                })
              }
            >
              {action.busy
                ? "正在处理…"
                : removing.can_delete
                  ? "确认删除"
                  : "确认停用"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
