export function financeError(error) {
  const message=String(error?.message||'');
  if(error?.code==='23505'||/unique constraint|duplicate key/.test(message))return 'הרשומה כבר קיימת. יש לבדוק את האסמכתה.';
  const labels={payment_payer_or_activity_mismatch:'התקבול אינו תואם לגורם המשלם או לפעילות.',receipt_already_allocated:'התקבול כבר שויך.',payment_exceeds_account_balance:'הסכום חורג מיתרת החשבון.',receipt_already_voided:'התקבול כבר בוטל.',dispatch_in_progress:'הפקת החשבון כבר מתבצעת.',stale_billing_reservation:'נתוני הפעילות השתנו. יש לעדכן את התצוגה המקדימה.',stale_billing_preview:'נתוני החיוב השתנו. יש לעדכן את התצוגה.',advance_payment_changed:'נתוני התקבולים השתנו. יש לעדכן את התצוגה המקדימה.',finance_collection_permission_denied:'אין הרשאה לביצוע הפעולה.',finance_transactions_permission_denied:'אין הרשאה לביצוע הפעולה.',cancellation_requires_admin_and_reason:'ביטול חשבון דורש הרשאת מנהל וסיבה.',payment_correction_permission_denied:'תיקון התקבול דורש את רושם התקבול או מנהל.'};
  Object.assign(labels, {
    finance_pdf_connection_failed:'החיבור לשירות הפקת החשבון נכשל. בדוק בהיסטוריה אם החשבון הופק לפני ניסיון נוסף.',
    finance_pdf_authorization_failed:'שירות הפקת החשבונות אינו מורשה להשלים את הפעולה. יש לפנות למנהל המערכת.',
    finance_pdf_dispatch_failed:'הפקת החשבון לא הושלמה. בדוק בהיסטוריה לפני ניסיון נוסף.',
    graph_not_configured:'חיבור SharePoint להפקת החשבונות אינו מוגדר.',
    graph_auth_failed:'החיבור ל־SharePoint נכשל. יש לבדוק את הרשאות השירות.',
    transaction_sharepoint_folder_invalid:'תיקיית שמירת חשבונות העסקה אינה זמינה.',
    account_not_dispatchable:'החשבון אינו זמין להפקה. יש לרענן את הרשימה.'
  });
  if(labels[message])return labels[message];
  if(/^sharepoint_upload_failed|^graph_request_failed|^issued_pdf_download_failed/.test(message)) return 'שמירת מסמך החשבון ב־SharePoint נכשלה. בדוק בהיסטוריה לפני ניסיון נוסף.';
  if(/[א-ת]/.test(message))return message.replace(/^billing_blocked:/,'');
  return 'לא ניתן להשלים את הפעולה. יש לבדוק את הנתונים ולנסות שוב.';
}
