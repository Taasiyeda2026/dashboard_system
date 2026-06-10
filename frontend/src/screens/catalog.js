const CATALOG_URL = './catalog/summercatalog/';
const COURSE_PAGE_ADMIN_BASE = './catalog/summercatalog/course-page.html?catalog=admin';
const ADMIN_TOKEN_KEY = 'tsy_catalog_admin_token';
const ADMIN_TOKEN_TTL = 30000;

function isCatalogAdmin(state) {
  return state?.user?.role === 'admin' || Number(state?.user?.user_id) === 8000;
}

function ensureCatalogEmbedStyles() {
  if (document.getElementById('catalog-embed-screen-styles')) return;
  const style = document.createElement('style');
  style.id = 'catalog-embed-screen-styles';
  style.textContent = `
.catalog-embed-screen {
  direction: rtl;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100dvh - 132px);
  color: #0f172a;
}
.catalog-embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.catalog-embed-title {
  display: grid;
  gap: 4px;
}
.catalog-embed-title h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
  font-weight: 800;
}
.catalog-embed-title p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.4;
}
.catalog-embed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.catalog-embed-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px solid #2563eb;
  border-radius: 999px;
  padding: 7px 14px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
  transition: background .16s ease, border-color .16s ease, transform .16s ease;
}
.catalog-embed-open:hover,
.catalog-embed-open:focus-visible {
  background: #1d4ed8;
  border-color: #1d4ed8;
  transform: translateY(-1px);
  outline: none;
}
.catalog-embed-admin-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px solid #7c3aed;
  border-radius: 999px;
  padding: 7px 14px;
  background: #fff;
  color: #7c3aed;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: background .16s ease, color .16s ease, transform .16s ease;
}
.catalog-embed-admin-btn:hover,
.catalog-embed-admin-btn:focus-visible {
  background: #7c3aed;
  color: #fff;
  transform: translateY(-1px);
  outline: none;
}
.catalog-embed-admin-group {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border: 1px solid #7c3aed;
  border-radius: 999px;
  background: #fff;
  overflow: hidden;
}
.catalog-embed-marketer-select {
  border: none;
  border-left: 1px solid #d8b4fe;
  border-radius: 0;
  background: #faf5ff;
  color: #7c3aed;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 0 10px 0 6px;
  height: 36px;
  cursor: pointer;
  outline: none;
  appearance: auto;
  min-width: 110px;
}
.catalog-embed-marketer-select:focus {
  background: #ede9fe;
}
.catalog-embed-admin-group .catalog-embed-admin-btn {
  border: none;
  border-radius: 0;
  border-right: none;
}
.catalog-embed-frame-wrap {
  flex: 1 1 auto;
  min-height: min(760px, calc(100dvh - 210px));
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}
.catalog-embed-frame {
  display: block;
  width: 100%;
  height: max(640px, calc(100dvh - 210px));
  border: 0;
  background: #fff;
}
@media (max-width: 720px) {
  .catalog-embed-screen {
    min-height: calc(100dvh - 106px);
    gap: 10px;
  }
  .catalog-embed-header {
    align-items: stretch;
    padding: 10px;
    border-radius: 14px;
  }
  .catalog-embed-title h2 {
    font-size: 19px;
  }
  .catalog-embed-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .catalog-embed-open,
  .catalog-embed-admin-btn {
    width: 100%;
  }
  .catalog-embed-frame-wrap {
    min-height: calc(100dvh - 190px);
    border-radius: 14px;
  }
  .catalog-embed-frame {
    height: calc(100dvh - 190px);
    min-height: 520px;
  }
}
  `.trim();
  document.head.appendChild(style);
}

export const catalogScreen = {
  render: (data, { state } = {}) => {
    ensureCatalogEmbedStyles();
    const isAdmin = isCatalogAdmin(state);
    const adminBtn = isAdmin
      ? `<div class="catalog-embed-admin-group">
          <select class="catalog-embed-marketer-select" id="catalog-admin-marketer-select" aria-label="שורת שיווק לקטלוג אדמין">
            <option value="none">ללא שיווק</option>
            <option value="yael">יעל אביב</option>
            <option value="israa">איסראא אבו-ראס</option>
          </select>
          <button type="button" class="catalog-embed-admin-btn" id="catalog-admin-open-btn">🔒 הפקת קטלוג אדמין</button>
        </div>`
      : '';
    return `<section class="catalog-embed-screen" aria-labelledby="catalog-embed-title">
      <header class="catalog-embed-header">
        <div class="catalog-embed-title">
          <h2 id="catalog-embed-title">קטלוג</h2>
          <p>קטלוג הקיץ החדש נטען מתוך המערכת.</p>
        </div>
        <div class="catalog-embed-actions">
          ${adminBtn}
          <a class="catalog-embed-open" href="${CATALOG_URL}" target="_blank" rel="noopener noreferrer">פתח בחלון חדש</a>
        </div>
      </header>
      <div class="catalog-embed-frame-wrap">
        <iframe
          class="catalog-embed-frame"
          src="${CATALOG_URL}"
          title="קטלוג תעשיידע לקיץ"
          loading="lazy"
        ></iframe>
      </div>
    </section>`;
  },

  bind({ root, state }) {
    if (!isCatalogAdmin(state)) return;
    const btn = root.querySelector('#catalog-admin-open-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const marketerSelect = root.querySelector('#catalog-admin-marketer-select');
      const marketer = marketerSelect?.value || 'none';
      let url = COURSE_PAGE_ADMIN_BASE;
      if (marketer && marketer !== 'none') url += `&marketer=${encodeURIComponent(marketer)}`;
      try {
        localStorage.setItem(
          ADMIN_TOKEN_KEY,
          JSON.stringify({ ok: true, exp: Date.now() + ADMIN_TOKEN_TTL })
        );
      } catch (_) {}
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
};
