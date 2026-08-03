const TARGET_PROPOSAL_TYPES = new Set([
  'gefen',
  'גפן',
  'גפ״ן',
  'next_year',
  'next_year_courses',
  'next_year_workshops',
  'תשפ״ז',
  'תשפז',
  'שנה הבאה',
  'שנת הלימודים תשפ״ז',
  'תוכניות תשפ״ז'
]);

function cleanFilenamePart(value = '') {
  return String(value || '')
    .replace(/["“”״]/g, '')
    .replace(/[\\/:*?<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSchoolProposalPdfFilenameType(value = '') {
  return TARGET_PROPOSAL_TYPES.has(String(value || '').replace(/\s+/g, ' ').trim());
}

export function proposalSchoolPdfTitle({ typeKey = '', semelMosad = '', schoolName = '' } = {}) {
  if (!isSchoolProposalPdfFilenameType(typeKey)) return '';
  const recipient = cleanFilenamePart(schoolName) || cleanFilenamePart(semelMosad);
  return recipient ? `הצעת מחיר ${recipient}` : 'הצעת מחיר';
}

function visibleProposalForms(root = document) {
  return Array.from(root?.querySelectorAll?.('[data-pa-form]') || []).filter((form) => {
    if (form.hidden || form.closest?.('[hidden]')) return false;
    return true;
  });
}

function proposalFormContext(root = document) {
  const forms = visibleProposalForms(root);
  const form = forms.find((candidate) => candidate.querySelector?.('input[name="contact_source_semel_mosad"]'))
    || forms.at(-1)
    || root?.querySelector?.('[data-pa-form]')
    || null;
  if (!form) return null;
  return {
    typeKey: form.querySelector?.('[name="activity_type_group"]')?.value || '',
    semelMosad: form.querySelector?.('input[name="contact_source_semel_mosad"]')?.value || '',
    schoolName: form.querySelector?.('[name="school_framework"]')?.value
      || form.querySelector?.('input[name="contact_source_school"]')?.value
      || ''
  };
}

function proposalPreviewContext(root = document) {
  const overlay = root?.querySelector?.('#pa-preview-overlay');
  if (!overlay) return null;
  const metaText = overlay.querySelector?.('.pa-gefen-school-meta')?.textContent || '';
  const clientText = overlay.querySelector?.('.ds-pa-preview-client')?.textContent || '';
  const semelMatch = metaText.match(/סמל מוסד:\s*([^|]+)/);
  const schoolMatch = metaText.match(/בית ספר:\s*([^|]+)/);
  const schoolFromClient = clientText.split('—').map((part) => part.trim()).filter(Boolean).at(-1) || '';
  return {
    typeKey: overlay.querySelector?.('.pa-gefen-recipient') ? 'gefen' : '',
    semelMosad: semelMatch?.[1]?.trim() || '',
    schoolName: schoolMatch?.[1]?.trim() || schoolFromClient
  };
}

export function resolveProposalSchoolPdfTitle(root = document) {
  const formContext = proposalFormContext(root);
  const previewContext = proposalPreviewContext(root);
  const typeKey = formContext?.typeKey || previewContext?.typeKey || '';
  return proposalSchoolPdfTitle({
    typeKey,
    semelMosad: formContext?.semelMosad || previewContext?.semelMosad || '',
    schoolName: formContext?.schoolName || previewContext?.schoolName || ''
  });
}

export function updateProposalSchoolPdfDocumentTitle(root = document) {
  if (!root?.querySelector?.('#pa-preview-overlay')) return false;
  const title = resolveProposalSchoolPdfTitle(root);
  if (!title || root.title === title) return false;
  root.title = title;
  return true;
}

export function installProposalSchoolPdfFilenameRuntime(scope = globalThis) {
  if (scope.__dsProposalSchoolPdfFilenameRuntimeInstalled) return false;
  const documentRef = scope?.document;
  if (!documentRef) return false;
  scope.__dsProposalSchoolPdfFilenameRuntimeInstalled = true;

  const update = () => updateProposalSchoolPdfDocumentTitle(documentRef);
  if (documentRef.readyState === 'loading') {
    documentRef.addEventListener('DOMContentLoaded', update, { once: true });
  } else {
    update();
  }

  if (typeof scope.MutationObserver === 'function') {
    new scope.MutationObserver(update)
      .observe(documentRef.documentElement, { childList: true, subtree: true });
  }
  return true;
}

installProposalSchoolPdfFilenameRuntime(globalThis);
