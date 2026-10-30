import { escapeHtml as e } from './shared/html.js';
import { dsTableWrap, dsEmptyState } from './shared/layout.js';
import { financeToday } from './finance-transaction-accounts.js';
const text=v=>String(v??'').trim();
const money=v=>`${Number(v||0).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2})} ₪`;
export function financeAccountBalances(data) {
  const map=new Map((data.paymentContext?.balances||[]).map(x=>[x.accountId,x]));
  return (data.transactionContext?.accounts||[]).filter(a=>['issued','mail_draft_ready','sent'].includes(a.document_status)).map(a=>({
    ...a,paidAmount:Number(map.get(a.id)?.paidAmount||0),balance:Number(map.get(a.id)?.balance??a.total_amount)
  }));
}
export function receiptAvailable(data,receipt) {
  if(receipt.voided_at)return 0;
  return Number(receipt.amount)-(data.paymentContext?.allocations||[]).filter(x=>x.receipt_id===receipt.id&&!x.released_at).reduce((n,x)=>n+Number(x.amount),0);
}
function receiptForm(data,account) {
  // When recording payment against a specific account, the payer and funder
  // come from that account. Do not ask the user to re-enter identity fields.
  if (account) {
    const funder = account.finance_transaction_account_lines?.[0]?.funding_source_id || account.funding_source_id_snapshot || '';
    return `<form data-finance-payment-form>
      <input type="hidden" name="account_id" value="${e(account.id)}">
      <input type="hidden" name="funding_source_id" value="${e(funder)}">
      <input type="hidden" name="payer_key" value="${e(account.payer_key_snapshot || '')}">
      <input type="hidden" name="payer_name" value="${e(account.payer_identity_snapshot || account.customer_name_snapshot || '')}">
      <input type="hidden" name="activity_row_id" value="">
      <div class="ds-fin-collect-toolbar">
        <label>סכום שהתקבל<input class="ds-input" name="amount" type="number" min="0.01" step="0.01" max="${e(account.balance)}" required value="${Number(account.balance).toFixed(2)}"></label>
        <label>תאריך קבלה<input class="ds-input" name="received_date" type="date" required max="${financeToday()}" value="${financeToday()}"></label>
        <label>אסמכתה<input class="ds-input" name="reference"></label>
        <details class="ds-fin-collect-extra"><summary>פרטי אסמכתה נוספים</summary>
          <label>מסמך קבלה / אסמכתה<input class="ds-input" name="document_reference"></label>
        </details>
        <button type="button" class="ds-btn ds-btn--primary" data-finance-receipt-save>שמירת תקבול</button>
      </div></form>`;
  }
  const sources=new Map((data.transactionContext?.billingRows||[]).filter(r=>r.fundingSourceId).map(r=>[r.fundingSourceId,r.funding]));
  for(const a of data.transactionContext?.accounts||[])for(const l of a.finance_transaction_account_lines||[])if(l.funding_source_id)sources.set(l.funding_source_id,l.funding_snapshot);
  const payerOptions=new Map((data.transactionContext?.billingRows||[]).filter(r=>r.payerKey).map(r=>[r.payerKey,r.payerName]));
  for(const a of data.transactionContext?.accounts||[])if(a.payer_key_snapshot)payerOptions.set(a.payer_key_snapshot,a.payer_identity_snapshot||a.customer_name_snapshot);
  const funder=account?.finance_transaction_account_lines?.[0]?.funding_source_id||'';
  return `<form data-finance-payment-form><input type="hidden" name="account_id" value="${e(account?.id||'')}">
    <div class="ds-fin-collect-toolbar">
    <label>גורם מימון<select class="ds-input" name="funding_source_id"><option value="">לשיוך</option>${[...sources].map(([id,name])=>`<option value="${e(id)}"${id===funder?' selected':''}>${e(name)}</option>`).join('')}</select></label>
    <label>זהות משלם<select class="ds-input" name="payer_key"><option value="">לשיוך</option>${[...payerOptions].map(([key,name])=>`<option value="${e(key)}"${key===account?.payer_key_snapshot?' selected':''}>${e(name)}</option>`).join('')}</select></label>
    <label>גורם משלם<input class="ds-input" name="payer_name" required value="${e(account?.payer_identity_snapshot||account?.customer_name_snapshot||'')}"></label>
    <label>פעילות<select class="ds-input" name="activity_row_id"><option value="">ללא שיוך לפעילות</option>${(data.collectionActivities||[]).map(a=>`<option value="${e(a.row_id)}">${e(a.school)} · ${e(a.activity_name)} · ${e(a.row_id)}</option>`).join('')}</select></label>
    <label>סכום<input class="ds-input" name="amount" type="number" min="0.01" step="0.01" required value="${account?Number(account.balance).toFixed(2):''}"></label>
    <label>תאריך קבלה<input class="ds-input" name="received_date" type="date" required max="${financeToday()}" value="${financeToday()}"></label>
    <label>אסמכתה<input class="ds-input" name="reference"></label>
    <label>מסמך קבלה / אסמכתה<input class="ds-input" name="document_reference"></label>
    <button type="button" class="ds-btn ds-btn--primary" data-finance-receipt-save>שמירת תקבול</button></div></form>`;
}
function accountReferences(data,id) {
  const receipts=new Map((data.paymentContext?.receipts||[]).map(r=>[r.id,r]));
  return (data.paymentContext?.allocations||[]).filter(x=>x.account_id===id&&!x.released_at).map(x=>{
    const r=receipts.get(x.receipt_id);return r?`${r.received_date} · ${r.reference} · ${money(x.amount)}`:'';
  }).filter(Boolean).join(' | ');
}
export function paymentsBodyHtml(data) {
  if(data.collectionError)return dsEmptyState(data.collectionError);
  const tab=data.collectionTab||'open';const query=text(data.collectionSearch).toLocaleLowerCase();
  const rows=financeAccountBalances(data).filter(a=>(tab==='all'||(tab==='closed'?a.balance===0:a.balance>0))&&[
    a.transaction_account_number,a.customer_name_snapshot,accountReferences(data,a.id),
    ...(a.finance_transaction_account_lines||[]).map(l=>`${l.school_name_snapshot||''} ${l.activity_name_snapshot||''}`)
  ].join(' ').toLocaleLowerCase().includes(query));
  // Collection is tracked by due date, never by the activity performance month.
  rows.sort((a,b)=>String(a.payment_due_date||'9999-12-31').localeCompare(String(b.payment_due_date||'9999-12-31'))
    ||Number(a.transaction_account_number||0)-Number(b.transaction_account_number||0));
  const rowHtml=(a)=>`<tr${a.balance>0&&a.payment_due_date<financeToday()?' class="ds-fin-overdue"':''}>
    <td>${a.sharepoint_web_url?`<a href="${e(a.sharepoint_web_url)}" target="_blank" rel="noopener" title="פתיחת חשבון PDF">${e(a.transaction_account_number)}</a>`:e(a.transaction_account_number)}</td>
    <td>${e(a.customer_name_snapshot)}</td>
    <td class="ds-fin-num">${e(money(a.total_amount))}</td>
    <td>${e(a.payment_due_date||'—')}${a.balance>0&&a.payment_due_date<financeToday()?'<strong class="ds-fin-save is-error">באיחור</strong>':''}</td>
    <td class="ds-fin-num">${e(money(a.balance))}${a.balance>0?`<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-fin-collect-payment-action" data-finance-payment-open="${e(a.id)}">רישום תשלום</button>`:''}</td>
    </tr>`;
  const groups=new Map();
  for(const a of rows){const key=a.payer_key_snapshot||`legacy:${a.id}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
  const table=[...groups.values()].map(group=>`<details class="ds-fin-payer" open>
    <summary>${e(group[0].payer_identity_snapshot||group[0].customer_name_snapshot)} · ${group.length} חשבונות · ${e(money(group.reduce((n,a)=>n+a.balance,0)))}</summary>
    ${dsTableWrap(`<table class="ds-table ds-fin-collect-accounts" dir="rtl"><thead><tr><th>מספר חשבון</th><th>גורם משלם</th><th>סכום החשבון</th><th>מועד תשלום</th><th>יתרה לתשלום</th></tr></thead><tbody>${group.map(rowHtml).join('')}</tbody></table>`)}</details>`).join('');
  const account=financeAccountBalances(data).find(a=>a.id===data.paymentAccountId);
  return `${account&&account.balance>0?`<details class="ds-fin-payer" open><summary>קליטת תשלום · חשבון ${e(account.transaction_account_number)}</summary>${receiptForm(data,account)}</details>`:''}
    ${table?table:dsEmptyState(tab==='closed'?'אין חשבונות ששולמו.':'אין חשבונות פתוחים לגבייה.')}`;
}
export function receiptsHtml(data) {
  const receipts=data.paymentContext?.receipts||[];
  const accounts=financeAccountBalances(data).filter(a=>a.balance>0);
  return `<details class="ds-fin-payer"><summary>תקבולים</summary>${receiptForm(data)}
    ${receipts.map(r=>`<details class="ds-fin-payer"><summary>${e(r.payer_name)} · ${e(r.received_date)} · ${e(money(r.amount))} · יתרה לשיוך ${e(money(receiptAvailable(data,r)))}</summary>
      <p>${e(r.reference)}${r.document_reference?' · '+e(r.document_reference):''}${r.voided_at?' · בוטל: '+e(r.void_reason):''}</p>
      ${!r.voided_at&&receiptAvailable(data,r)>0?`<form data-finance-allocation-form data-receipt-id="${e(r.id)}"><label>חשבון<select class="ds-input" name="account_activity">${accounts.filter(a=>(!r.payer_key||a.payer_key_snapshot===r.payer_key)&&(!r.funding_source_id||a.finance_transaction_account_lines?.some(l=>l.funding_source_id===r.funding_source_id))).flatMap(a=>(a.finance_transaction_account_lines||[]).filter(l=>!r.funding_source_id||l.funding_source_id===r.funding_source_id).map(l=>`<option value="${e(a.id+'|'+l.activity_row_id)}">${e(a.transaction_account_number)} · ${e(a.customer_name_snapshot)} · ${e(l.activity_name_snapshot)}</option>`)).join('')}</select></label>
        <label>סכום לשיוך<input class="ds-input" name="amount" type="number" min="0.01" step="0.01" max="${receiptAvailable(data,r)}"></label><button class="ds-btn" type="button" data-finance-allocate>שיוך תקבול</button></form>`:''}
      ${!r.voided_at?`<button class="ds-btn ds-btn--ghost" data-finance-receipt-correct="${e(r.id)}">תיקון תקבול</button>`:''}</details>`).join('')}</details>`;
}
export function accountPaymentAllocation(data,accountId,amount) {
  const account=financeAccountBalances(data).find(a=>a.id===accountId);if(!account)throw Error('החשבון אינו זמין לגבייה');
  let left=Number(amount);const result=[];
  for(const line of account.finance_transaction_account_lines||[]) {
    const paid=(data.paymentContext?.allocations||[]).filter(x=>x.account_id===accountId&&x.activity_row_id===line.activity_row_id&&!x.released_at).reduce((n,x)=>n+Number(x.amount),0);
    const value=Math.min(left,Number(line.amount)-paid);if(value>0){result.push({account_id:accountId,activity_row_id:line.activity_row_id,amount:value});left-=value;}
  }
  if(left>0.001)throw Error('הסכום חורג מיתרת החשבון');return result;
}
