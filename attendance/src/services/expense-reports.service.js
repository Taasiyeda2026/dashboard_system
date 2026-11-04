import { supabase } from '../api/client.js';
import { uploadAttachment,deleteAttachment,getSignedUrl } from './storage.service.js';

export async function listExpenseReports({fromDate,toDate,employeeIds=null}={}) {
  const {data,error}=await supabase.rpc('av2_list_expenses',{
    p_from:fromDate,p_to:toDate,
    p_emp_ids:employeeIds?.length?employeeIds.map(Number):null
  });
  if(error)throw new Error('לא ניתן לטעון את ההוצאות');
  return Array.isArray(data)?data:[];
}

export async function saveExpenseReport({date,amount,details,id=null}={}) {
  const value=Number(amount);
  if(!date || !Number.isFinite(value)||value<=0||value>100000
    ||String(details||'').trim().length<2) {
    throw new Error('יש להזין תאריך, סכום ופירוט הוצאה');
  }
  const {data,error}=await supabase.rpc('av2_save_expense',{
    p_expense_date:date,p_amount:value,p_details:String(details).trim(),p_expense_id:id||null
  });
  if(error)throw new Error(error.message||'שמירת ההוצאה נכשלה');
  return data;
}

export async function attachExpenseReceipt({file,employeeId,expenseId,email=''}={}) {
  if(!file || file.size<=0 || file.size>10*1024*1024
    || !['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)){
    throw new Error('ניתן לצרף PDF או תמונה עד 10MB');
  }
  const path=await uploadAttachment(file,employeeId,expenseId,{employeeEmail:email});
  const {error}=await supabase.rpc('av2_expense_attachment_add',{
    p_expense_id:expenseId,p_storage_path:path,p_file_name:file.name,
    p_file_type:file.type,p_file_size:file.size
  });
  if(error){
    await deleteAttachment(path).catch(()=>null);
    throw new Error('שמירת המסמך נכשלה');
  }
}

export async function reviewExpenseReport({id,decision,approvedAmount=null}={}){
  const {data,error}=await supabase.rpc('av2_review_expense',{
    p_expense_id:id,p_decision:decision,
    p_amount:decision==='correct'?Number(approvedAmount):null
  });
  if(error)throw new Error(error.message||'אישור ההוצאה נכשל');
  return data;
}

export { getSignedUrl as expenseReceiptSignedUrl };
