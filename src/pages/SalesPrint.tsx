import { Button, Modal } from "../ui";
import {
  moneyText,
  decimalText,
  printAmountFields,
  defaultPrintAmountRule,
  type Sale,
  type CatalogEntry,
} from "../sales";
import { nativeBrowser, openDesktopBrowser } from "../browserLogin";
import { Notice, useAction } from "../components";
import { useAppUpdates } from "../NativeTools";

export default function SalesPrint({
  sale,
  company,
  onClose,
}: {
  sale: Sale;
  company?: CatalogEntry;
  onClose: () => void;
}) {
  const action = useAction();
  const { info } = useAppUpdates();
  const settings = company?.data.print_settings;
  const amounts = {
    ...sale,
    return_credit: sale.returns.reduce((sum, entry) => sum + entry.credit, 0),
  };
  const summary = printAmountFields.filter(({ key }) => {
    const rule = settings?.amounts?.[key] ?? defaultPrintAmountRule(key);
    return rule === "always" || (rule === "nonzero" && amounts[key] !== 0);
  });
  const addressRule = settings?.delivery_address ?? "nonempty";
  const showAddress =
    addressRule === "always" ||
    (addressRule === "nonempty" && !!sale.customer.data.address?.trim());
  return (
    <Modal title="单据打印预览" variant="print" onClose={onClose}>
      <div className="sales-print-tools">
        <p>A4 纵向 · 系统打印可保存 PDF</p>
        <Button className="button" onClick={onClose}>
          关闭预览
        </Button>
        <Button
          className="button primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              const native = nativeBrowser();
              const mobile = native
                ? (
                    info ??
                    ((await native.invoke("update_info", {})) as {
                      mobile: boolean;
                    })
                  ).mobile
                : false;
              if (native && mobile) {
                const url = new URL(location.origin);
                url.searchParams.set("sale_print", sale.id);
                await openDesktopBrowser(url.href);
              } else if (native) {
                await native.invoke("print_document", {});
              } else window.print();
            })
          }
        >
          {nativeBrowser() && info?.mobile
            ? "在系统浏览器打印"
            : "系统打印 / 保存 PDF"}
        </Button>
        {action.error && <Notice>{action.error}</Notice>}
      </div>
      <article className="sales-print-sheet">
        <header>
          <strong className="print-company">
            {company?.name || "销售清单"}
          </strong>
          <p>
            {company?.data.phone && `联系电话：${company.data.phone}`}　
            {company?.data.address && `地址：${company.data.address}`}
          </p>
        </header>
        <div className="print-heading">
          <h1>{sale.type_name}</h1>
          <div>
            单号：{sale.number}
            <br />
            业务日期：{sale.business_date}
          </div>
        </div>
        <div className="print-customer">
          <span>客户：{sale.customer.name}</span>
          <span>联系人：{sale.customer.data.contact || "—"}</span>
          <span>电话：{sale.customer.data.phone || "—"}</span>
          <span>开单人：{sale.actor_name}</span>
          <span>业绩部门：{sale.department_name || "未指定"}</span>
          <span>部门业务员：{sale.salesperson_name || "未指定"}</span>
          {showAddress && (
            <span className="print-wide">
              送货地址：{sale.customer.data.address?.trim() || "—"}
            </span>
          )}
        </div>
        <table aria-label="打印明细">
          <thead>
            <tr>
              <th>序号</th>
              <th>物料名称 / 规格</th>
              <th>单位</th>
              <th className="num">数量</th>
              {sale.billable && (
                <>
                  <th className="num">单价（元）</th>
                  <th className="num">金额（元）</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l, i) => (
              <tr key={l.item_id}>
                <td>{i + 1}</td>
                <td>
                  {l.name}
                  <small>{l.spec}</small>
                </td>
                <td>{l.unit}</td>
                <td className="num">{decimalText(l.quantity, 3)}</td>
                {sale.billable && (
                  <>
                    <td className="num">{decimalText(l.price, 4)}</td>
                    <td className="num">{moneyText(l.amount)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {sale.billable && (
          <div className="print-summary">
            <div>
              <strong>收款记录</strong>
              {sale.payments.map((p) => (
                <p key={p.id}>
                  {p.business_date} · {p.account_name} · ¥{moneyText(p.amount)}
                  <br />
                  经办人：{p.actor_name}
                  {p.reversal_of && " · 冲销"}
                </p>
              ))}
            </div>
            {summary.length > 0 && (
              <dl>
                {summary.map(({ key, label }) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>¥{moneyText(amounts[key])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
        <p className="print-note">备注：{sale.note || "—"}</p>
        <div className="print-signatures">
          <p>发货经办人：________________</p>
          <p>
            客户签收：________________
            <br />
            签收日期：________________
          </p>
        </div>
        <footer>
          币种：人民币（CNY） · 本单为销售及收款凭据，不代替税务发票。
        </footer>
      </article>
    </Modal>
  );
}
