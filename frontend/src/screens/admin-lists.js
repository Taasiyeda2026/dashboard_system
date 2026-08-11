import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { showToast } from './shared/toast.js';

export const adminListsScreen = {
  load: async ({ api }) => {
    const [lists, funding] = await Promise.all([api.adminLists(), api.fundingSources({ includeInactive: true })]);
    return { ...lists, fundingSources: funding.rows || [] };
  },
  render(data) {
    const categories = Array.isArray(data?.categories) ? data.categories : [];
    const sources = Array.isArray(data?.fundingSources) ? data.fundingSources : [];
    const fundingBody = `<form data-funding-add style="display:flex;gap:8px;margin-bottom:12px"><input class="ds-input" name="name" required placeholder="שם גורם מימון"><button class="ds-btn ds-btn--primary">הוספה</button></form>
      ${sources.length ? `<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>שם</th><th>פעיל</th><th>שמירה</th></tr></thead><tbody>${sources.map((source) => `<tr data-funding-row="${escapeHtml(source.id)}"><td><input class="ds-input" name="name" value="${escapeHtml(source.name)}"></td><td><input type="checkbox" name="is_active"${source.is_active ? ' checked' : ''}></td><td><button class="ds-btn ds-btn--sm" data-funding-save>שמור</button></td></tr>`).join('')}</tbody></table></div>` : dsEmptyState('אין גורמי מימון')}`;
    const listsBody = categories.length === 0 ? dsEmptyState('אין רשימות') : categories.map((cat) => dsCard({ title: escapeHtml(cat.category), padded: true, body: `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px">${(cat.items || []).map((item) => `<li><span class="ds-badge">${escapeHtml(item.label || item.value)}</span></li>`).join('')}</ul>` })).join('');
    return dsScreenStack(`${dsPageHeader('ניהול רשימות', `${categories.length} קטגוריות`)}${dsCard({ title: 'גורמי מימון', padded: true, body: fundingBody })}${listsBody}`);
  },
  bind({ root, api, rerender, clearScreenDataCache }) {
    root.querySelector('[data-funding-add]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button'); button.disabled = true;
      try { await api.addFundingSource({ name: event.currentTarget.elements.name.value }); clearScreenDataCache?.(); showToast('גורם המימון נוסף'); rerender?.(); }
      catch (error) { showToast(error.message === 'funding_source_duplicate' ? 'גורם מימון בשם זה כבר קיים' : error.message, 'error'); }
      finally { button.disabled = false; }
    });
    root.querySelectorAll('[data-funding-save]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-funding-row]'); button.disabled = true;
      try { await api.updateFundingSource({ id: row.dataset.fundingRow, name: row.querySelector('[name=name]').value, is_active: row.querySelector('[name=is_active]').checked }); clearScreenDataCache?.(); showToast('גורם המימון עודכן'); rerender?.(); }
      catch (error) { showToast(error.message === 'funding_source_duplicate' ? 'גורם מימון בשם זה כבר קיים' : error.message, 'error'); }
      finally { button.disabled = false; }
    }));
  }
};
