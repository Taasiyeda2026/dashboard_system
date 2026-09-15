import React from 'react';
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';

const h = React.createElement;
const PATCH_KEY = Symbol.for('taasiyeda.proposalVectorPdfRuntime');
const GENERATED_PDF_FILES = new WeakSet();

if (typeof window !== 'undefined') {
  const fontFaces = [
    [new URL('../assets/fonts/Arimo-Regular.ttf', import.meta.url).href, 400],
    [new URL('../assets/fonts/Arimo-Medium.ttf', import.meta.url).href, 500],
    [new URL('../assets/fonts/Arimo-SemiBold.ttf', import.meta.url).href, 600],
    [new URL('../assets/fonts/Arimo-Bold.ttf', import.meta.url).href, 700]
  ];
  for (const [src, fontWeight] of fontFaces) Font.register({ family: 'Arimo', src, fontWeight });
}
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Arimo',
    fontSize: 9.2,
    paddingTop: 30,
    paddingRight: 34,
    paddingBottom: 32,
    paddingLeft: 34,
    direction: 'rtl',
    color: '#1f2937',
    lineHeight: 1.34
  },
  paragraph: { textAlign: 'right', direction: 'rtl', marginBottom: 5 },
  meta: { textAlign: 'right', direction: 'rtl', marginBottom: 3, fontSize: 8.7 },
  h1: { textAlign: 'right', direction: 'rtl', fontSize: 16, fontWeight: 700, color: '#1d4e89', marginTop: 4, marginBottom: 9 },
  h2: { textAlign: 'right', direction: 'rtl', fontSize: 13, fontWeight: 700, color: '#1d4e89', marginTop: 7, marginBottom: 6 },
  h3: { textAlign: 'right', direction: 'rtl', fontSize: 11, fontWeight: 700, color: '#243b53', marginTop: 6, marginBottom: 4 },
  h4: { textAlign: 'right', direction: 'rtl', fontSize: 9.8, fontWeight: 700, marginTop: 5, marginBottom: 3 },
  divider: { borderBottomWidth: 0.6, borderBottomColor: '#94a3b8', marginVertical: 7 },
  list: { marginBottom: 5 },
  listRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', marginBottom: 2 },
  listMarker: { width: 16, textAlign: 'right', fontWeight: 600 },
  listText: { flexGrow: 1, flexBasis: 0, textAlign: 'right', direction: 'rtl' },
  table: { width: '100%', borderTopWidth: 0.55, borderRightWidth: 0.55, borderColor: '#64748b', marginTop: 5, marginBottom: 8 },
  tableRow: { flexDirection: 'row-reverse', borderBottomWidth: 0.55, borderColor: '#64748b', minHeight: 22 },
  tableHeaderRow: { backgroundColor: '#e7eef6' },
  tableCell: { borderLeftWidth: 0.55, borderColor: '#64748b', paddingHorizontal: 3, paddingVertical: 3, justifyContent: 'center' },
  tableHeaderText: { textAlign: 'center', direction: 'rtl', fontWeight: 700, fontSize: 7.8 },
  tableText: { textAlign: 'right', direction: 'rtl', fontSize: 7.8 },
  imageWrap: { alignItems: 'flex-end', marginVertical: 4 },
  logo: { width: 72, maxHeight: 50, objectFit: 'contain' },
  signature: { width: 96, maxHeight: 58, objectFit: 'contain' },
  image: { width: 110, maxHeight: 95, objectFit: 'contain' }
});

function clean(value) {
  return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
}

function classText(element) {
  return clean(element?.getAttribute?.('class')).toLowerCase();
}

function textWithBreaks(element) {
  if (!element?.cloneNode) return clean(element?.textContent);
  const clone = element.cloneNode(true);
  clone.querySelectorAll?.('br').forEach((br) => br.replaceWith('\n'));
  return clean(clone.textContent);
}

function isNoPrint(element) {
  const classes = classText(element);
  return classes.split(/\s+/).includes('no-print') || element?.getAttribute?.('aria-hidden') === 'true';
}

function hasPageBreak(element) {
  const classes = classText(element);
  const style = clean(element?.getAttribute?.('style')).toLowerCase();
  return classes.includes('page-break') || classes.includes('pa-page-break') || /page-break-before\s*:\s*always|break-before\s*:\s*page/.test(style);
}

function resolveImageSource(element, documentRef) {
  const src = clean(element?.getAttribute?.('src'));
  if (!src) return '';
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  try { return new URL(src, documentRef?.baseURI || globalThis.location?.href || import.meta.url).href; }
  catch { return ''; }
}

function imageKind(element) {
  const hint = `${classText(element)} ${clean(element?.getAttribute?.('alt')).toLowerCase()} ${clean(element?.getAttribute?.('src')).toLowerCase()}`;
  if (/signature|חתימ/.test(hint)) return 'signature';
  if (/logo|לוגו|taasiyeda/.test(hint)) return 'logo';
  return 'image';
}

function tableBlock(table) {
  const rows = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'));
  if (!rows.length) return null;
  const normalizedRows = rows.map((row) => {
    const cells = Array.from(row.children).filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    return {
      header: cells.length > 0 && cells.every((cell) => cell.tagName === 'TH'),
      cells: cells.map((cell) => ({
        text: textWithBreaks(cell),
        colspan: Math.max(1, Number(cell.getAttribute('colspan')) || 1),
        header: cell.tagName === 'TH'
      }))
    };
  }).filter((row) => row.cells.length);
  const columns = Math.max(1, ...normalizedRows.map((row) => row.cells.reduce((sum, cell) => sum + cell.colspan, 0)));
  return normalizedRows.length ? { type: 'table', rows: normalizedRows, columns } : null;
}

const CONTAINER_TAGS = new Set(['ARTICLE', 'MAIN', 'SECTION', 'HEADER', 'FOOTER', 'DIV', 'ADDRESS', 'FIGURE', 'FIGCAPTION']);
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL', 'IMG', 'HR']);

function collectElementBlocks(element, blocks, documentRef) {
  if (!element || isNoPrint(element)) return;
  if (hasPageBreak(element)) blocks.push({ type: 'break' });
  const tag = element.tagName;

  if (/^H[1-6]$/.test(tag)) {
    const value = textWithBreaks(element);
    if (value) blocks.push({ type: 'heading', level: Number(tag.slice(1)), text: value });
    return;
  }
  if (tag === 'P') {
    const value = textWithBreaks(element);
    if (value) blocks.push({ type: 'text', text: value, meta: classText(element).includes('meta') });
    return;
  }
  if (tag === 'TABLE') {
    const value = tableBlock(element);
    if (value) blocks.push(value);
    return;
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(element.children)
      .filter((child) => child.tagName === 'LI')
      .map((child) => textWithBreaks(child))
      .filter(Boolean);
    if (items.length) blocks.push({ type: 'list', ordered: tag === 'OL', items });
    return;
  }
  if (tag === 'IMG') {
    const src = resolveImageSource(element, documentRef);
    if (src) blocks.push({ type: 'image', src, kind: imageKind(element) });
    return;
  }
  if (tag === 'HR') {
    blocks.push({ type: 'divider' });
    return;
  }

  const children = Array.from(element.children || []);
  if (CONTAINER_TAGS.has(tag)) {
    const hasBlockChildren = children.some((child) => BLOCK_TAGS.has(child.tagName) || CONTAINER_TAGS.has(child.tagName));
    if (!hasBlockChildren) {
      const value = textWithBreaks(element);
      if (value) blocks.push({ type: 'text', text: value, meta: classText(element).includes('meta') });
      return;
    }
    children.forEach((child) => collectElementBlocks(child, blocks, documentRef));
    return;
  }

  if (children.length) {
    children.forEach((child) => collectElementBlocks(child, blocks, documentRef));
    return;
  }
  const value = textWithBreaks(element);
  if (value) blocks.push({ type: 'text', text: value });
}

export function proposalHtmlToVectorModel(html, documentRef = globalThis.document) {
  if (!documentRef?.createElement) throw new Error('proposal_vector_pdf_document_unavailable');
  const host = documentRef.createElement('div');
  host.innerHTML = String(html || '');
  const root = host.querySelector('.proposal-document') || host;
  const blocks = [];
  Array.from(root.children || []).forEach((child) => collectElementBlocks(child, blocks, documentRef));
  if (!blocks.length) {
    const fallback = textWithBreaks(root);
    if (fallback) blocks.push({ type: 'text', text: fallback });
  }
  if (!blocks.length) throw new Error('proposal_vector_pdf_empty_document');
  return blocks;
}

function renderTable(block, key) {
  const fontSize = block.columns >= 7 ? 6.7 : block.columns >= 5 ? 7.2 : 7.8;
  return h(View, { key, style: styles.table },
    ...block.rows.map((row, rowIndex) => h(View, {
      key: `${key}-row-${rowIndex}`,
      style: [styles.tableRow, row.header ? styles.tableHeaderRow : null].filter(Boolean),
      wrap: false
    }, ...row.cells.map((cell, cellIndex) => h(View, {
      key: `${key}-cell-${rowIndex}-${cellIndex}`,
      style: [styles.tableCell, { width: `${(cell.colspan / block.columns) * 100}%` }]
    }, h(Text, { style: [cell.header || row.header ? styles.tableHeaderText : styles.tableText, { fontSize }] }, cell.text))))));
}

function renderBlock(block, index) {
  const key = `proposal-vector-${index}`;
  if (block.type === 'break') return h(View, { key, break: true });
  if (block.type === 'divider') return h(View, { key, style: styles.divider });
  if (block.type === 'heading') {
    const headingStyle = block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : block.level === 3 ? styles.h3 : styles.h4;
    return h(Text, { key, style: headingStyle, minPresenceAhead: 24 }, block.text);
  }
  if (block.type === 'text') return h(Text, { key, style: block.meta ? styles.meta : styles.paragraph }, block.text);
  if (block.type === 'list') {
    return h(View, { key, style: styles.list }, ...block.items.map((item, itemIndex) => h(View, {
      key: `${key}-item-${itemIndex}`,
      style: styles.listRow,
      wrap: false
    }, h(Text, { style: styles.listMarker }, block.ordered ? `${itemIndex + 1}.` : '•'), h(Text, { style: styles.listText }, item))));
  }
  if (block.type === 'table') return renderTable(block, key);
  if (block.type === 'image') {
    const imageStyle = block.kind === 'logo' ? styles.logo : block.kind === 'signature' ? styles.signature : styles.image;
    return h(View, { key, style: styles.imageWrap, wrap: false }, h(Image, { src: block.src, style: imageStyle }));
  }
  return null;
}

export function ProposalVectorPdfDocument({ html, title = 'הצעת מחיר', documentRef = globalThis.document }) {
  const blocks = proposalHtmlToVectorModel(html, documentRef);
  return h(Document, { title, author: 'תעשיידע', creator: 'Taasiyeda Dashboard' },
    h(Page, { size: 'A4', style: styles.page, wrap: true }, ...blocks.map(renderBlock).filter(Boolean))
  );
}

export async function proposalHtmlToVectorPdfBlob(html, { title = 'הצעת מחיר', documentRef = globalThis.document } = {}) {
  const element = h(ProposalVectorPdfDocument, { html, title, documentRef });
  const blob = await pdf(element).toBlob();
  if (!blob || blob.size < 5) throw new Error('proposal_vector_pdf_empty');
  const signature = await blob.slice(0, 5).text();
  if (signature !== '%PDF-') throw new Error('proposal_vector_pdf_invalid_signature');
  return blob;
}

function safeFileName(value, fallback = 'proposal.pdf') {
  const normalized = clean(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized || fallback.replace(/\.pdf$/i, '')}.pdf`;
}

export async function createProposalVectorPdfFile({ proposalId = '', html = '', title = 'הצעת מחיר', fileName = '' } = {}, scope = globalThis) {
  const blob = await proposalHtmlToVectorPdfBlob(html, { title, documentRef: scope.document });
  const name = safeFileName(fileName || `proposal-${clean(proposalId) || 'document'}.pdf`);
  const PdfFile = scope.File;
  const file = typeof PdfFile === 'function'
    ? new PdfFile([blob], name, { type: 'application/pdf', lastModified: Date.now() })
    : Object.assign(blob, { name, lastModified: Date.now() });
  if (file && typeof file === 'object') GENERATED_PDF_FILES.add(file);
  return file;
}

export async function saveProposalVectorPdf(apiClient, {
  proposalId,
  documentHtmlSnapshot,
  documentSnapshot = {},
  title = 'הצעת מחיר',
  fileName = ''
} = {}, scope = globalThis) {
  if (!apiClient || typeof apiClient.uploadProposalFinalPdf !== 'function') throw new Error('proposal_vector_pdf_upload_unavailable');
  const id = clean(proposalId);
  const html = String(documentHtmlSnapshot || '');
  if (!id) throw new Error('proposal_vector_pdf_missing_id');
  if (!html.trim()) throw new Error('proposal_vector_pdf_missing_html');
  const pdfFile = await createProposalVectorPdfFile({ proposalId: id, html, title, fileName }, scope);
  return apiClient.uploadProposalFinalPdf(id, {
    pdfFile,
    file: pdfFile,
    documentSnapshot: documentSnapshot && typeof documentSnapshot === 'object' ? documentSnapshot : {},
    documentHtmlSnapshot: html
  });
}

export function installProposalClientVectorPdfRuntime(targetApi, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  targetApi.createProposalFinalPdfFile = async ({ row = {}, previewHtml = '' } = {}) => {
    const id = clean(row?.id);
    const quote = clean(row?.quote_number);
    return createProposalVectorPdfFile({
      proposalId: id,
      html: previewHtml,
      title: quote ? `הצעת מחיר ${quote}` : 'הצעת מחיר',
      fileName: quote ? `הצעת_מחיר_${quote}.pdf` : `proposal-${id || 'document'}.pdf`
    }, scope);
  };

  targetApi.requestProposalFinalPdf = async function requestProposalClientVectorPdf(id, payload = {}) {
    const html = String(payload?.documentHtmlSnapshot || payload?.document_html_snapshot || '');
    if (!html.trim()) {
      console.warn('[proposal vector pdf] skipped automatic save: missing HTML snapshot', { proposalId: id });
      return { ok: false, skipped: true, reason: 'missing_html_snapshot' };
    }
    try {
      const result = await saveProposalVectorPdf(targetApi, {
        proposalId: id,
        documentHtmlSnapshot: html,
        documentSnapshot: payload?.documentSnapshot || payload?.document_snapshot || {},
        title: 'הצעת מחיר'
      }, scope);
      return { ...(result || {}), ok: true, generation_source: 'client-vector' };
    } catch (error) {
      console.error('[proposal vector pdf] automatic save failed', { proposalId: id, message: error?.message || String(error) });
      return { ok: false, error: error?.message || String(error), generation_source: 'client-vector' };
    }
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

export function isProposalVectorPdfFile(file) {
  return Boolean(file && typeof file === 'object' && GENERATED_PDF_FILES.has(file));
}
