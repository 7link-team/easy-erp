import { Button, Form, Input, Select, Checkbox } from "../ui";
import { useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { type User, send, api } from "../api";
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

interface Role {
  id: string;
  name: string;
  permissions: string[];
  version: number;
  members?: number;
  protected: boolean;
}
interface Permission {
  id: string;
  module: string;
  label: string;
  requires: string[];
}
interface Roles {
  roles: Role[];
  permissions: Permission[];
}

function RoleEditor({
  role,
  definitions,
  onClose,
  onSaved,
}: {
  role?: Role;
  definitions: Permission[];
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState(role?.permissions ?? []);
  const action = useAction();
  const modules = [...new Set(definitions.map((p) => p.module))];
  function toggle(id: string, checked: boolean) {
    setPermissions((previous) => {
      const next = new Set(previous);
      if (checked) {
        const add = (permission: string) => {
          if (next.has(permission)) return;
          next.add(permission);
          definitions.find((p) => p.id === permission)?.requires.forEach(add);
        };
        add(id);
      } else {
        next.delete(id);
        let changed = true;
        while (changed) {
          changed = false;
          for (const permission of next) {
            if (
              definitions
                .find((p) => p.id === permission)
                ?.requires.some((required) => !next.has(required))
            ) {
              next.delete(permission);
              changed = true;
            }
          }
        }
      }
      return [...next];
    });
  }
  return (
    <Modal title={role ? "修改角色" : "新增角色"} onClose={onClose}>
      <Form
        onSubmit={(e) =>
          form(e, () =>
            action.run(async () => {
              const result = await send<{ id: string }>("/roles", {
                id: role?.id,
                version: role?.version,
                name,
                permissions,
              });
              await onSaved(result.id);
            }),
          )
        }
      >
        <Field label="角色名称" required>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              autoComplete="off"
              name="role_name"
            />
          )}
        </Field>
        <p className="hint">
          勾选此角色允许的操作。勾选操作时自动选中所需权限。销售单据与收发记录未勾选“查看所有人”时，仅能查看和操作本人的记录。修改后，该角色的账号需重新登录。
        </p>
        <div className="permission-matrix">
          {modules.map((module) => (
            <fieldset key={module}>
              <legend>{module}</legend>
              <div className="permission-options">
                {definitions
                  .filter((p) => p.module === module)
                  .map((p) => (
                    <label className="checkbox" key={p.id}>
                      <Checkbox
                        checked={permissions.includes(p.id)}
                        onChange={(e) => toggle(p.id, e.target.checked)}
                        aria-label={`${module}：${p.label}`}
                      />
                      {p.label}
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p className="hint">
          人员账号、角色权限、导入导出和主机设置由受保护的管理员维护。已有业务记录使用停用或作废，保留历史记录。
        </p>
        {action.error && <Notice>{action.error}</Notice>}
        <div className="form-actions form-footer">
          <Button className="button" onClick={onClose}>
            取消
          </Button>
          <Submit busy={action.busy}>保存角色</Submit>
        </div>
      </Form>
    </Modal>
  );
}

export default function Users({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const { data, error } = useResource<User[]>("/users", revision);
  const roles = useResource<Roles>("/roles", revision);
  const [editing, setEditing] = useState<User | "new">();
  const [roleEditing, setRoleEditing] = useState<Role | "new">();
  const [deleting, setDeleting] = useState<Role>();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(true);
  const [role, setRole] = useState("");
  const [roleAdded, setRoleAdded] = useState<Role>();
  const roleChoices = [
    ...(roles.data?.roles ?? []),
    ...(roleAdded && !roles.data?.roles.some((r) => r.id === roleAdded.id)
      ? [roleAdded]
      : []),
  ];
  const action = useAction();
  const remove = useAction();
  function open(user?: User) {
    setEditing(user ?? "new");
    setName(user?.name ?? "");
    setUsername(user?.username ?? "");
    setPassword("");
    setActive(user?.active ?? true);
    setRole(user?.role ?? "");
    action.setError("");
  }
  const selectedRole = roleChoices.find((r) => r.id === role);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>人员与角色</h1>
          <p>为账号分配角色，按业务模块管理操作权限。</p>
        </div>
        <Button className="button primary" onClick={() => open()}>
          <Plus size={17} aria-hidden="true" />
          添加人员账号
        </Button>
      </div>
      {(error || roles.error) && <Notice>{error || roles.error}</Notice>}
      <section className="panel ledger-sheet" aria-label="人员账号">
        <div className="section-title ledger-heading">
          <h2>人员账号</h2>
        </div>
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>登录账号</th>
                <th>角色</th>
                <th>登录状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                  </td>
                  <td>{user.username}</td>
                  <td>{user.role_name}</td>
                  <td>{user.active ? "允许登录" : "已停用"}</td>
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
      <section
        className="panel ledger-sheet roles-section"
        aria-label="角色管理"
      >
        <div className="section-title ledger-heading">
          <div>
            <h2>角色管理</h2>
            <p className="hint">
              角色可自行维护；修改权限将应用到使用此角色的所有账号。
            </p>
          </div>
          <Button className="button" onClick={() => setRoleEditing("new")}>
            <Plus size={17} aria-hidden="true" />
            新增角色
          </Button>
        </div>
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>角色</th>
                <th>权限</th>
                <th>使用人数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.data?.roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.protected && (
                      <small>
                        <ShieldCheck size={14} aria-hidden="true" /> 受保护
                      </small>
                    )}
                  </td>
                  <td>
                    {r.protected
                      ? "全部权限"
                      : `${r.permissions.length} 项操作`}
                  </td>
                  <td>
                    {r.members ??
                      data?.filter((u) => u.role === r.id).length ??
                      0}
                  </td>
                  <td>
                    {r.protected ? (
                      "系统管理员"
                    ) : (
                      <div className="row-actions">
                        <Button
                          className="button small"
                          onClick={() => setRoleEditing(r)}
                          aria-label={`修改角色：${r.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          修改
                        </Button>
                        <Button
                          className="button small"
                          disabled={!!r.members}
                          title={
                            r.members
                              ? "请先为使用此角色的账号更换角色"
                              : undefined
                          }
                          onClick={() => {
                            remove.setError("");
                            setDeleting(r);
                          }}
                          aria-label={`删除角色：${r.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          删除
                        </Button>
                      </div>
                    )}
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
                  spellCheck={false}
                />
              )}
            </Field>
            <Field
              label={editing === "new" ? "登录密码" : "重置密码"}
              required={editing === "new"}
              hint={
                editing === "new"
                  ? "至少 8 个字符，可以使用容易记住的一句话。"
                  : "不修改密码请留空。修改账号后需重新登录。"
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
            {editing === "new" || editing.role !== "admin" ? (
              <>
                <Field
                  label="角色"
                  required
                  hint={
                    selectedRole
                      ? `${selectedRole.name}：${selectedRole.permissions.length} 项操作权限。`
                      : "选择已维护的角色。"
                  }
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      createLabel="新增角色"
                      onCreate={() => setRoleEditing("new")}
                      required
                    >
                      <option value="">请选择角色</option>
                      {roleChoices
                        .filter((r) => !r.protected)
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <fieldset>
                  <legend>账号状态</legend>
                  <label className="checkbox">
                    <Checkbox
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    允许此账号登录
                  </label>
                  <p className="hint">停用登录不删除账号和历史操作记录。</p>
                </fieldset>
              </>
            ) : (
              <p className="hint">管理员受保护，始终拥有全部权限并允许登录。</p>
            )}
            {action.error && <Notice>{action.error}</Notice>}
            <div className="form-actions form-footer">
              <Button className="button" onClick={() => setEditing(undefined)}>
                取消
              </Button>
              <Submit busy={action.busy}>保存账号</Submit>
            </div>
          </Form>
        </Modal>
      )}
      {roleEditing && roles.data && (
        <RoleEditor
          role={roleEditing === "new" ? undefined : roleEditing}
          definitions={roles.data.permissions}
          onClose={() => setRoleEditing(undefined)}
          onSaved={async (id) => {
            if (editing) {
              const result = await api<Roles>("/roles");
              setRoleAdded(result.roles.find((r) => r.id === id));
              setRole(id);
            }
            setRoleEditing(undefined);
            refresh();
          }}
        />
      )}
      {deleting && (
        <Modal title="删除角色" onClose={() => setDeleting(undefined)}>
          <Form
            onSubmit={(e) =>
              form(e, () =>
                remove.run(async () => {
                  await send(`/roles/${deleting.id}`, {}, "DELETE");
                  setDeleting(undefined);
                  refresh();
                }),
              )
            }
          >
            <p>确定删除“{deleting.name}”？此角色没有账号使用。</p>
            {remove.error && <Notice>{remove.error}</Notice>}
            <div className="form-actions form-footer">
              <Button className="button" onClick={() => setDeleting(undefined)}>
                取消
              </Button>
              <Submit busy={remove.busy}>删除角色</Submit>
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
