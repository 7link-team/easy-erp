import { Button, Form, Input, Select, Checkbox } from "../ui";
import { useState } from "react";
import { type User, send } from "../api";
import {
  TableScroll,
  Field,
  Modal,
  Notice,
  Submit,
  form,
  useAction,
  useResource,
} from "../components";

export default function Users({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const { data, error } = useResource<User[]>("/users", revision);
  const [editing, setEditing] = useState<User | "new">();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [canIn, setCanIn] = useState(true);
  const [canOut, setCanOut] = useState(true);
  const [canCount, setCanCount] = useState(true);
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<User["role"]>("worker");
  const action = useAction();
  function open(user?: User) {
    setEditing(user ?? "new");
    setName(user?.name ?? "");
    setUsername(user?.username ?? "");
    setPassword("");
    setCanIn(user?.can_in ?? true);
    setCanOut(user?.can_out ?? true);
    setCanCount(user?.can_count ?? true);
    setActive(user?.active ?? true);
    setRole(user?.role ?? "worker");
    action.setError("");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>人员</h1>
          <p>每人一个账号，收发操作记到本人名下。</p>
        </div>
        <Button className="button primary" onClick={() => open()}>
          添加人员账号
        </Button>
      </div>
      <section className="panel">
        {error && <Notice>{error}</Notice>}
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>登录账号</th>
                <th>角色</th>
                <th>权限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    {!user.active && <small>已停用</small>}
                  </td>
                  <td>{user.username}</td>
                  <td>
                    {user.role === "admin"
                      ? "管理员"
                      : user.role === "viewer"
                        ? "查看员"
                        : "操作员"}
                  </td>
                  <td>
                    {user.role === "admin"
                      ? "全部业务管理"
                      : [
                          user.can_in && "入库",
                          user.can_out && "出库",
                          user.can_count && "填写清点",
                        ]
                          .filter(Boolean)
                          .join("、") || "只看库存"}
                  </td>
                  <td>
                    <Button className="button small" onClick={() => open(user)}>
                      修改权限
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </section>
      {editing && (
        <Modal
          title={editing === "new" ? "添加人员账号" : "修改人员与权限"}
          onClose={() => setEditing(undefined)}
        >
          <Form
            onSubmit={(e) =>
              form(e, () =>
                action.run(async () => {
                  await send(
                    editing === "new" ? "/users" : `/users/${editing.id}`,
                    {
                      name,
                      username,
                      password: password || undefined,
                      role,
                      can_in: role !== "viewer" && canIn,
                      can_out: role !== "viewer" && canOut,
                      can_count: role !== "viewer" && canCount,
                      active,
                    },
                    editing === "new" ? "POST" : "PUT",
                  );
                  setEditing(undefined);
                  refresh();
                }),
              )
            }
          >
            <Field
              label="姓名"
              required
              hint="例如：张师傅。操作记录显示这个名字。"
            >
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                  required
                />
              )}
            </Field>
            <Field
              label="登录账号"
              required
              hint="3–32 位字母、数字、下划线或短横线。"
            >
              {(p) => (
                <Input
                  {...p}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  readOnly={editing !== "new"}
                  minLength={3}
                  maxLength={32}
                  required
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              label={editing === "new" ? "登录密码" : "重置密码"}
              required={editing === "new"}
              hint={
                editing === "new"
                  ? "至少 8 个字符，可以使用容易记住的一句话。"
                  : "不修改密码请留空。修改权限或密码后需重新登录。"
              }
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={editing === "new"}
                  minLength={password ? 8 : undefined}
                  maxLength={128}
                  autoComplete="new-password"
                />
              )}
            </Field>
            {(editing === "new" || editing.role !== "admin") && (
              <>
                <Field
                  label="角色"
                  required
                  hint="操作员按勾选的权限登记业务；查看员只能查看，不能修改库存。"
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={role}
                      onChange={(e) => setRole(e.target.value as User["role"])}
                    >
                      <option value="worker">操作员</option>
                      <option value="viewer">查看员</option>
                    </Select>
                  )}
                </Field>
                <fieldset>
                  <legend>允许做什么</legend>
                  <label className="checkbox">
                    <Checkbox
                      checked={role !== "viewer" && canIn}
                      disabled={role === "viewer"}
                      onChange={(e) => setCanIn(e.target.checked)}
                    />
                    入库
                  </label>
                  <label className="checkbox">
                    <Checkbox
                      checked={role !== "viewer" && canOut}
                      disabled={role === "viewer"}
                      onChange={(e) => setCanOut(e.target.checked)}
                    />
                    出库
                  </label>
                  <label className="checkbox">
                    <Checkbox
                      checked={role !== "viewer" && canCount}
                      disabled={role === "viewer"}
                      onChange={(e) => setCanCount(e.target.checked)}
                    />
                    填写清点数量
                  </label>
                  <label className="checkbox">
                    <Checkbox
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    允许此账号登录
                  </label>
                </fieldset>
              </>
            )}
            {action.error && <Notice>{action.error}</Notice>}
            <div className="form-actions">
              <Button
                type="button"
                className="button"
                onClick={() => setEditing(undefined)}
              >
                取消
              </Button>
              <Submit busy={action.busy}>保存账号</Submit>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
