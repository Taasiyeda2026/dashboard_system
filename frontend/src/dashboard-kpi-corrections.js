import { api } from './api.js';

const ESCAPE_ROOM_KPI_ACTION = 'kpi|active_escape_room';
const SUMMER_KPI_ACTION = 'kpi|summer';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanTypeCounts(counts = {}) {
  const out = { ...(counts && typeof counts === 'object' ? counts : {}) };
  delete out.summer;
  return out;
}

function makeEscapeRoomKpi(value) {
  const count = asNumber(value);
  return {
    id: 'active_escape_room',
    action: ESCAPE_ROOM_KPI_ACTION,
    subtitle: 'חדר בריחה',
    title: String(count),
    value: count
  };
}

function insertEscapeRoomKpi(cards, escapeRoomCard) {
  const cleaned = (Array.isArray(cards) ? cards : [])
    .filter((card) => card && card.action !== SUMMER_KPI_ACTION && card.id !== 'summer')
    .filter((card) => card.action !== ESCAPE_ROOM_KPI_ACTION && card.id !== 'active_escape_room');

  const workshopIndex = cleaned.findIndex((card) => card.action === 'kpi|active_workshops');
  const tourIndex = cleaned.findIndex((card) => card.action === 'kpi|active_tours');
  const insertAt = workshopIndex >= 0 ? workshopIndex + 1 : (tourIndex >= 0 ? tourIndex : cleaned.length);
  cleaned.splice(insertAt, 0, escapeRoomCard);
  return cleaned;
}

function normalizeDashboardKpis(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const totalTypeCounts = cleanTypeCounts(payload.totalTypeCounts || {});
  const activeTypeCounts = cleanTypeCounts(payload.activeTypeCounts || payload.summary?.active_type_counts || {});
  const summary = payload.summary && typeof payload.summary === 'object'
    ? { ...payload.summary, active_type_counts: activeTypeCounts }
    : payload.summary;

  const escapeRoomCount = asNumber(
    payload.totalTypeCounts?.escape_room ??
    payload.activeTypeCounts?.escape_room ??
    payload.summary?.active_type_counts?.escape_room ??
    0
  );

  const cardsSource = Array.isArray(payload.kpi_cards)
    ? payload.kpi_cards
    : (Array.isArray(payload.cards) ? payload.cards : []);
  const kpiCards = insertEscapeRoomKpi(cardsSource, makeEscapeRoomKpi(escapeRoomCount));

  return {
    ...payload,
    summary,
    activeTypeCounts,
    totalTypeCounts,
    kpi_cards: kpiCards,
    cards: kpiCards
  };
}

const originalDashboardReadModel = api.dashboardReadModel?.bind(api);
if (typeof originalDashboardReadModel === 'function') {
  api.dashboardReadModel = async (...args) => normalizeDashboardKpis(await originalDashboardReadModel(...args));
}
