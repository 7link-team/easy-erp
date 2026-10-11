import { Button, Modal } from "../ui";
import {
  moneyText,
  decimalText,
  saleStatus,
  type Sale,
  type CatalogEntry,
} from "../sales";
import { nativeBrowser, openDesktopBrowser } from "../browserLogin";
import { Notice, useAction } from "../components";

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
              if (nativeBrowser()) {
                const url = new URL(location.origin);
                url.searchParams.set("sale_print", sale.id);
                await openDesktopBrowser(url.href);
              } else window.print();
            })
          }
        >
          {nativeBrowser() ? "在系统浏览器打印" : "系统打印 / 保存 PDF"}
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
            业务日期：{sale.business_date}　版本：V{sale.version}
            <br />
            {saleStatus(sale)}
          </div>
        </div>
        <div className="print-customer">
          <span>客户：{sale.customer.name}</span>
          <span>联系人：{sale.customer.data.contact || "—"}</span>
          <span>电话：{sale.customer.data.phone || "—"}</span>
          <span>开单人：{sale.actor_name}</span>
          <span>业绩部门：{sale.department_name || "未指定"}</span>
          <span>部门业务员：{sale.salesperson_name || "未指定"}</span>
          <span className="print-wide">
            送货地址：{sale.customer.data.address || "—"}
          </span>
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
            <dl>
              {[
                ["原金额", sale.subtotal],
                ["折扣金额", sale.discount],
                ["抹零金额", sale.rounding],
                ["原单应收", sale.total],
                ["退货减免", sale.returns.reduce((a, r) => a + r.credit, 0)],
                ["当前应收", sale.due],
                ["净实收", sale.paid],
                ["剩余欠款", sale.debt],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>¥{moneyText(value as number)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p className="print-note">备注：{sale.note || "—"}</p>
        <div className="print-signatures">
          {sale.status === "posted" && sale.billable && sale.debt > 0 && (
            <p className="print-debt-confirmation">
              本单当前应收 ¥{moneyText(sale.due)}，已收 ¥{moneyText(sale.paid)}
              ，<strong>剩余欠款 ¥{moneyText(sale.debt)}</strong>。
              请客户核对货物及上述金额后签字确认。
            </p>
          )}
          <p>发货经办人：________________</p>
          <p>
            {sale.status === "posted" && sale.billable && sale.debt > 0
              ? "客户签收及欠款确认"
              : "客户签收"}
            ：________________
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
