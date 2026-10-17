import { useState } from "react";
import { api } from "./api";
import { Field, Notice, Submit, form, useAction } from "./components";
import { Form, Input, Select, Checkbox } from "./ui";

export interface DatabaseStatus {
  initialized: boolean;
  database_configured?: boolean;
  setup_token_required?: boolean;
}

export default function DatabaseSetup({
  onDone,
}: {
  onDone: (status: DatabaseStatus, token: string) => void;
}) {
  const [kind, setKind] = useState("sqlite");
  const [token, setToken] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3306");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  const action = useAction();
  return (
    <main className="login-page">
      <section className="login-intro">
        <h1>
          设置库存
          <br />
          数据库。
        </h1>
        <p>选择数据保存方式。已有数据请使用原来的数据目录或数据库。</p>
      </section>
      <section className="login-card">
        <h2>服务器首次初始化</h2>
        <p className="muted">
          SQLite 保存在服务器本地；MySQL 连接已有数据库，需具备建表权限。
        </p>
        <Form
          onSubmit={(event) =>
            form(event, () =>
              action.run(async () => {
                const settings =
                  kind === "sqlite"
                    ? { kind }
                    : {
                        kind,
                        host,
                        port: Number(port),
                        database,
                        username,
                        password,
                        tls,
                      };
                await api("/database/setup", {
                  method: "POST",
                  headers: { "X-ERP-Setup-Token": token },
                  body: JSON.stringify(settings),
                });
                // Setup switches to the normal service on the same address.
                const deadline = Date.now() + 15_000;
                while (Date.now() < deadline) {
                  try {
                    const status = await api<DatabaseStatus>("/status");
                    if (status.database_configured) {
                      onDone(status, token);
                      return;
                    }
                  } catch {
                    /* Wait for the service to finish opening this database. */
                  }
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, 300),
                  );
                }
                throw new Error(
                  "配置已保存，服务尚未就绪，请刷新页面重新连接。",
                );
              }),
            )
          }
        >
          <Field
            label="初始化口令"
            required
            hint="从服务器首次启动日志或数据目录的 setup-token 文件获取。"
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            )}
          </Field>
          <Field label="数据库类型" required>
            {(props) => (
              <Select
                {...props}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="sqlite">本地 SQLite</option>
                <option value="mysql">MySQL</option>
              </Select>
            )}
          </Field>
          {kind === "mysql" && (
            <>
              <Field label="MySQL 主机" required>
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    placeholder="例如 mysql 或 192.168.1.10"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                  />
                )}
              </Field>
              <Field label="MySQL 端口" required>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min="1"
                    max="65535"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                )}
              </Field>
              <Field label="数据库名称" required>
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                  />
                )}
              </Field>
              <Field label="数据库用户名" required>
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                )}
              </Field>
              <Field label="数据库密码">
                {(props) => (
                  <Input
                    {...props}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </Field>
              <label className="checkbox">
                <Checkbox
                  checked={tls}
                  onChange={(event) => setTls(event.target.checked)}
                />
                使用 TLS 加密连接
              </label>
            </>
          )}
          {action.error && <Notice>{action.error}</Notice>}
          <Submit busy={action.busy}>保存并初始化数据库</Submit>
        </Form>
      </section>
    </main>
  );
}
