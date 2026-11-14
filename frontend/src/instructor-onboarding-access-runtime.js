import { supabase } from './supabase-client.js';

const PATCH_FLAG = Symbol.for('taasiyeda.instructorOnboardingAccessPatched');

function onboardingRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function provisionAccess(empId) {
  const { data, error } = await supabase.functions.invoke('instructor-onboarding-access', {
    body: { emp_id: Number(empId) }
  });
  if (error || !data?.ok) {
    const failure = new Error(data?.message || error?.message || 'לא ניתן לפתוח גישה לדשבורד ולמערכת הנוכחות.');
    failure.code = 'onboarding_access_failed';
    throw failure;
  }
  return data;
}

if (!supabase[PATCH_FLAG]) {
  const originalRpc = supabase.rpc.bind(supabase);

  supabase.rpc = function patchedRpc(functionName, args, options) {
    const request = originalRpc(functionName, args, options);
    // Preserve PostgREST builders (.select/.in/.range) for unrelated reads.
    if (functionName !== 'create_instructor_onboarding') return request;
    return Promise.resolve(request).then(async (result) => {
      if (result?.error) return result;

      const row = onboardingRow(result?.data);
      const empId = Number(row?.emp_id);
      if (!Number.isSafeInteger(empId) || empId <= 0) return result;

      try {
        await provisionAccess(empId);
        return result;
      } catch (error) {
        console.error('[instructor-onboarding-access-runtime]', error);
        return {
          ...result,
          error: {
            message: 'המדריך נוצר, אך פתיחת הגישה לדשבורד ולמערכת הנוכחות נכשלה. ניתן לנסות שוב.'
          }
        };
      }
    });
  };

  Object.defineProperty(supabase, PATCH_FLAG, { value: true });
}
