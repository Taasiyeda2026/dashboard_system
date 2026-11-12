import { canAccessBudget } from './budget-access.js';

export const BUDGET_APP_ENDPOINT = 'https://iyvvaolbwtavznanxmsj.supabase.co/functions/v1/budget-app';

// Fetch private interface under the existing dashboard JWT. Tokens never enter URLs
// or the document; the temporary document inherits this origin and reads the shared session.
export async function launchBudget({ user, getSession, openWindow = () => window.open('', '_blank'), request = fetch,
  createDocumentUrl = html => URL.createObjectURL(new Blob([html], { type: 'text/html' })),
  releaseDocumentUrl = url => setTimeout(() => URL.revokeObjectURL(url), 60000) }) {
  if (!canAccessBudget(user)) throw new Error('אין הרשאת גישה לבקרה התקציבית.');
  const popup = openWindow();
  if (!popup) throw new Error('יש לאפשר פתיחת חלון עבור הבקרה התקציבית.');
  popup.opener = null;
  popup.document.title = 'בקרה תקציבית';
  popup.document.body.textContent = 'טוען בקרה תקציבית…';
  try {
    const { data, error } = await getSession();
    if (error || !data?.session?.access_token) throw new Error('יש לחזור לדשבורד לחידוש ההזדהות.');
    const response = await request(BUDGET_APP_ENDPOINT, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) throw new Error('לא ניתן לפתוח את הבקרה התקציבית. יש לבדוק את ההרשאה בדשבורד.');
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('המערכת אינה זמינה כעת.');
    const payload = await response.json();
    if (payload.document_type !== 'taasiyeda-protected-budget-v1' || typeof payload.html !== 'string') {
      throw new Error('המערכת אינה זמינה כעת.');
    }
    const html = payload.html;
    // Logout/account switch during the request must not open a previously authorized app.
    const latest = await getSession();
    if (latest.error || latest.data?.session?.user?.id !== user.auth_user_id || !canAccessBudget(user)) {
      throw new Error('ההזדהות השתנתה. יש לחזור למסך הניהול.');
    }
    if (popup.closed) return;
    const documentUrl = createDocumentUrl(html);
    try { popup.location.replace(documentUrl); }
    finally { releaseDocumentUrl(documentUrl); }
  } catch (error) {
    popup.close();
    throw error;
  }
}
