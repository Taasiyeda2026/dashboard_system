/**
 * Impact feedback — QR projection view and link sharing helpers (admin side).
 */
import QRCode from 'qrcode';
import { STAGE_LABELS, mailtoUrl, publicFeedbackUrl, shareMessage, shareSubject, whatsappUrl } from './feedback-domain.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function appBaseHref() {
  return `${window.location.origin}${window.location.pathname}`;
}

export function campaignLink(campaign) {
  const token = campaign?.audience === 'student' ? campaign.public_token : campaign?.recipient?.token;
  return token ? publicFeedbackUrl(token, appBaseHref()) : '';
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

export function personalShareLinks(campaign, { programTitle, schoolName }) {
  const url = campaignLink(campaign);
  const recipient = campaign?.recipient || {};
  const text = shareMessage({ audience: campaign.audience, stage: campaign.stage, recipientName: recipient.display_name, programTitle, schoolName, url });
  return {
    url,
    text,
    whatsapp: whatsappUrl(recipient.phone, text),
    email: mailtoUrl(recipient.email, shareSubject(campaign.audience, programTitle, campaign.stage), text),
    hasPhone: Boolean(String(recipient.phone || '').replace(/\D/g, '')),
    hasEmail: Boolean(String(recipient.email || '').includes('@'))
  };
}

/** Full-screen projection view of a student campaign QR. */
export async function openQrProjection(campaign, { programTitle, schoolName, grade, onCopy } = {}) {
  const url = campaignLink(campaign);
  if (!url) return;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111426', light: '#ffffff' } });
  const overlay = document.createElement('div');
  overlay.className = 'ifb-qr-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'קוד QR למשוב');
  overlay.innerHTML = `
    <div class="ifb-qr">
      <button type="button" class="ifb-qr__close" data-qr-close aria-label="סגירה">✕</button>
      <p class="ifb-qr__kicker">שאלון ${esc(STAGE_LABELS[campaign.stage] || '')} · סורקים וממלאים</p>
      <h2 class="ifb-qr__title">${esc(programTitle || '')}</h2>
      <p class="ifb-qr__meta">${esc([schoolName, grade ? `שכבה ${grade}` : ''].filter(Boolean).join(' · '))}</p>
      <div class="ifb-qr__code">${svg}</div>
      <p class="ifb-qr__hint">אין צורך בהתחברות · השאלון אנונימי</p>
      <p class="ifb-qr__url" dir="ltr">${esc(url)}</p>
      <div class="ifb-qr__actions">
        <button type="button" class="ifb-btn" data-qr-copy>העתק קישור</button>
        <button type="button" class="ifb-btn" data-qr-download>הורדת תמונת QR</button>
        <button type="button" class="ifb-btn" data-qr-fullscreen>מסך מלא</button>
      </div>
    </div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay || event.target.closest('[data-qr-close]')) { close(); return; }
    if (event.target.closest('[data-qr-copy]')) {
      const ok = await copyText(url);
      onCopy?.(ok);
      return;
    }
    if (event.target.closest('[data-qr-download]')) {
      const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 1024, errorCorrectionLevel: 'M' });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${campaign.stage}-${String(schoolName || 'feedback').replace(/[\\/?%*:|"<>\s]+/g, '_')}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    if (event.target.closest('[data-qr-fullscreen]')) {
      overlay.requestFullscreen?.().catch(() => {});
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  overlay.querySelector('[data-qr-close]')?.focus();
}
