const CATALOG_URL = './catalog/summercatalog/';

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
  .catalog-embed-open {
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
  render: () => {
    ensureCatalogEmbedStyles();
    return `<section class="catalog-embed-screen" aria-labelledby="catalog-embed-title">
      <header class="catalog-embed-header">
        <div class="catalog-embed-title">
          <h2 id="catalog-embed-title">קטלוג</h2>
          <p>קטלוג הקיץ החדש נטען מתוך המערכת.</p>
        </div>
        <a class="catalog-embed-open" href="${CATALOG_URL}" target="_blank" rel="noopener noreferrer">פתח בחלון חדש</a>
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
  }
};
