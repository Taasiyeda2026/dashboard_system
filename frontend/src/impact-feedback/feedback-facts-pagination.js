/**
 * Supabase/PostgREST limits rows returned by one RPC request (often 1,000).
 * Page the *answer facts*, not the submitted forms: each form has many rows.
 * Fetch every page so analysis counts and complete questionnaires agree.
 */
export const FEEDBACK_FACTS_PAGE_SIZE = 500;

export async function loadAllFeedbackFactPages(fetchPage, pageSize = FEEDBACK_FACTS_PAGE_SIZE) {
  if (typeof fetchPage !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError('Invalid feedback facts page loader');
  }

  const all = [];
  for (let start = 0; ; start += pageSize) {
    const page = await fetchPage(start, start + pageSize - 1);
    if (!Array.isArray(page) || page.length > pageSize) {
      // In particular, do not silently duplicate records if the server ignores range().
      throw new Error('Invalid feedback facts page');
    }
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}
