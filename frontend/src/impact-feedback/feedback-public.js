/**
 * Standalone public feedback page (feedback.html?t=<token>). No login, no app shell.
 * Talks to Supabase only through feedback_public_get / feedback_public_submit.
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../supabase-client.js';
import { PUBLIC_STATE_MESSAGES, THANK_YOU } from './feedback-domain.js';
import { messageCardHtml, mountFeedbackForm } from './feedback-form.js';
import './feedback-form.css';

const logoUrl = new URL('../../assets/certificates/logos/taasiyeda1.png', import.meta.url).href;

const publicClient = supabaseConfig.isConfigured
  ? createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'impact-feedback-public' },
    global: { headers: { 'x-client-info': 'impact-feedback-public' } }
  })
  : null;

function safeStorage(kind) {
  try {
    const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__ifb_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

const local = safeStorage('local');
const session = safeStorage('session');

function newSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readToken() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('t') || '').trim();
}

function storageKey(prefix, token) {
  // Keys are per link; only a short slice of the token is used so storage never holds the full secret.
  return `ifb:${prefix}:${token.slice(0, 12)}`;
}

function setTitle(text) {
  document.title = text ? `${text} – משוב תעשיידע` : 'משוב – תעשיידע';
}

function showMessage(root, stateKey, extra = '') {
  const message = PUBLIC_STATE_MESSAGES[stateKey] || PUBLIC_STATE_MESSAGES.error;
  root.innerHTML = `<div class="ifb-shell">${messageCardHtml({ ...message, logoUrl, extra })}</div>`;
  root.setAttribute('aria-busy', 'false');
}

function showThanks(root, { allowAnother = false, onAnother } = {}) {
  root.innerHTML = `<div class="ifb-shell">${messageCardHtml({
    ...THANK_YOU,
    logoUrl,
    extra: allowAnother ? '<button type="button" class="ifb-message__link" data-another>מישהו נוסף רוצה למלא במכשיר הזה?</button>' : ''
  })}</div>`;
  root.setAttribute('aria-busy', 'false');
  root.querySelector('[data-another]')?.addEventListener('click', () => onAnother?.());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function rpc(name, args) {
  if (!publicClient) throw new Error('missing_config');
  const { data, error } = await publicClient.rpc(name, args);
  if (error) throw error;
  return data;
}

async function start() {
  const root = document.getElementById('feedback-root');
  if (!root) return;
  const token = readToken();
  if (!token) {
    showMessage(root, 'invalid');
    return;
  }

  let payload;
  try {
    payload = await rpc('feedback_public_get', { p_token: token });
  } catch {
    showMessage(root, 'error', '<button type="button" class="ifb-message__link" onclick="location.reload()">לנסות שוב</button>');
    return;
  }

  if (!payload || payload.state !== 'ok') {
    showMessage(root, payload?.state || 'invalid');
    return;
  }
  setTitle(payload.program_title);

  const isStudent = payload.audience === 'student';
  const doneKey = storageKey('done', token);
  const draftKey = storageKey('draft', token);
  const submissionKey = storageKey('submission', token);

  const renderForm = () => {
    let initialAnswers = {};
    try { initialAnswers = JSON.parse(session?.getItem(draftKey) || '{}') || {}; } catch { initialAnswers = {}; }
    const startedAt = Date.now();
    mountFeedbackForm(root, payload, {
      logoUrl,
      initialAnswers,
      onChange(answers) {
        try { session?.setItem(draftKey, JSON.stringify(answers)); } catch { /* ignore */ }
      },
      async onSubmit(answers) {
        // Same id for retries of the same filling -> the server stores it once.
        let submissionId = session?.getItem(submissionKey);
        if (!submissionId) {
          submissionId = newSubmissionId();
          session?.setItem(submissionKey, submissionId);
        }
        let result;
        try {
          result = await rpc('feedback_public_submit', {
            p_token: token,
            p_submission_id: submissionId,
            p_answers: answers,
            p_duration_seconds: Math.round((Date.now() - startedAt) / 1000)
          });
        } catch {
          throw new Error('לא הצלחנו לשלוח – בדקו את החיבור לאינטרנט ונסו שוב. התשובות שלכם שמורות.');
        }
        if (result?.ok) {
          session?.removeItem(draftKey);
          session?.removeItem(submissionKey);
          local?.setItem(doneKey, new Date().toISOString());
          showThanks(root, {
            allowAnother: isStudent,
            onAnother: () => { local?.removeItem(doneKey); renderForm(); window.scrollTo({ top: 0 }); }
          });
          return result;
        }
        if (result?.state === 'invalid_answers') return result;
        showMessage(root, result?.state || 'error');
        return result;
      }
    });
    root.setAttribute('aria-busy', 'false');
  };

  if (isStudent && local?.getItem(doneKey)) {
    showThanks(root, {
      allowAnother: true,
      onAnother: () => { local?.removeItem(doneKey); renderForm(); }
    });
    return;
  }
  renderForm();
}

start();
