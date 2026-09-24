import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><main id="root"></main></body>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.CustomEvent = dom.window.CustomEvent;

globalThis.__DASHBOARD_SKIP_AUTO_RENDER__ = true;

const { activitiesScreen } = await import('../frontend/src/screens/activities.js');
const {
  filterCoreActivitiesRows,
  readContactsForSchool2027Activities
} = await import('../frontend/src/api.js');
const { withResolvedSchool2027Contact } = await import('../frontend/src/screens/shared/school-2027-contact.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function school2027Row(overrides = {}) {
  return {
    id: 'activity-1',
    row_id: 'A-1',
    RowID: 'A-1',
    activity_season: 'school_2027',
    activity_domain: 'Y',
    israa_shared: true,
    authority: 'רשות א',
    school: 'בית ספר א',
    school_id: 'school-1',
    activity_name: 'פעילות',
    activity_type: 'course',
    status: 'פתוח',
    funding: 'רשות',
    contact_name: 'איש קשר שמור',
    contact_phone: '03-0000000',
    ...overrides
  };
}

function loadingApi(contactPromise, rows = [school2027Row()]) {
  return {
    activities: async () => ({ rows }),
    fundingSources: async () => ({ rows: [] }),
    enrichActivitiesContacts: () => contactPromise
  };
}

test('Activities renders core rows before school contact enrichment resolves', async () => {
  const contacts = deferred();
  const state = { activityPeriodTab: 'school_2027', activitiesInnerTab: 'school_2027', clientSettings: {} };
  const core = await activitiesScreen.load({ api: loadingApi(contacts.promise), state });

  assert.equal(core.rows.length, 1);
  assert.equal(core.rows[0].contact_name, 'איש קשר שמור');
  assert.match(activitiesScreen.render(core, { state: { ...state, user: { permissions: { view_activities: true } } } }), /פעילות/);

  contacts.resolve({ rows: [{ ...core.rows[0], resolved_school_2027_contact: { name: 'איש קשר מועשר', phone: '050-1111111', email: '', role: '', id: 'contact-1', source: 'school_contact_id' } }] });
  const enriched = await core._contactEnrichmentPromise;
  assert.equal(enriched.rows[0].resolved_school_2027_contact.name, 'איש קשר מועשר');
});

test('slow contact lookup cannot block usable Activities core rows or route guard', async () => {
  const contacts = deferred();
  const state = { activityPeriodTab: 'school_2027', activitiesInnerTab: 'school_2027', clientSettings: {} };
  const simulatedRouteGuard = new Promise((_, reject) => setTimeout(() => reject(new Error('route_load_timeout')), 25));

  const core = await Promise.race([
    activitiesScreen.load({ api: loadingApi(contacts.promise), state }),
    simulatedRouteGuard
  ]);

  assert.equal(core.rows[0].RowID, 'A-1');
  assert.equal(core._contactEnrichmentApplied, false);
});

function fakeContactsClient({ rejectFallbackSchool = '' } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, in: [], eq: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        in(column, values) { call.in.push({ column, values }); return builder; },
        eq(column, value) { call.eq.push({ column, value }); return builder; },
        neq() { return builder; },
        limit() { return builder; },
        then(resolve, reject) {
          const school = call.eq.find((entry) => entry.column === 'school')?.value || '';
          if (school && school === rejectFallbackSchool) return Promise.reject(new Error('fallback_failed')).then(resolve, reject);
          const idValues = call.in.find((entry) => entry.column === 'id')?.values || [];
          const schoolValues = call.in.find((entry) => entry.column === 'school_id')?.values || [];
          const data = idValues.length
            ? [{ id: idValues[0], school_id: 'school-1', contact_name: 'מזהה', active: 'פעיל' }]
            : schoolValues.length
              ? [{ id: 'by-school', school_id: schoolValues[0], contact_name: 'בית ספר', active: 'פעיל' }]
              : [{ id: `fallback-${school}`, authority: 'רשות ב', school, contact_name: `חלופה ${school}`, active: 'פעיל' }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

test('contact enrichment batches ids and schools and deduplicates normalized fallback pairs', async () => {
  const client = fakeContactsClient();
  const rows = [
    school2027Row({ row_id: '1', school_contact_id: 'contact-1', school_id: 'school-1' }),
    school2027Row({ row_id: '2', school_contact_id: 'contact-1', school_id: 'school-1' }),
    school2027Row({ row_id: '3', school_contact_id: '', school_id: '', authority: ' רשות ב ', school: 'בית   ספר ב' }),
    school2027Row({ row_id: '4', school_contact_id: '', school_id: '', authority: 'רשות ב', school: ' בית ספר ב ' }),
    school2027Row({ row_id: '5', school_contact_id: '', school_id: '', authority: '', school: '' })
  ];

  await readContactsForSchool2027Activities(rows, { client });

  assert.equal(client.calls.filter((call) => call.in.some((entry) => entry.column === 'id')).length, 1);
  assert.equal(client.calls.filter((call) => call.in.some((entry) => entry.column === 'school_id')).length, 1);
  assert.equal(client.calls.filter((call) => call.eq.some((entry) => entry.column === 'authority')).length, 1);
  assert.equal(client.calls.length, 3);
});

test('one failed fallback preserves successful contact results and usable stored fields', async () => {
  const client = fakeContactsClient({ rejectFallbackSchool: 'בית ספר נכשל' });
  const rows = [
    school2027Row({ row_id: '1', school_contact_id: 'contact-1', school_id: 'school-1' }),
    school2027Row({ row_id: '2', school_contact_id: '', school_id: '', authority: 'רשות ב', school: 'בית ספר נכשל', contact_name: 'שמור' })
  ];

  const contacts = await readContactsForSchool2027Activities(rows, { client });
  const enriched = rows.map((row) => withResolvedSchool2027Contact(row, contacts));

  assert.ok(contacts.some((contact) => contact.id === 'contact-1'));
  assert.equal(enriched[0].resolved_contact_name, 'מזהה');
  assert.equal(enriched[1].resolved_contact_name, 'שמור');
});

test('private Israa activity is filtered before background contact enrichment', () => {
  const rows = filterCoreActivitiesRows([
    school2027Row({ row_id: 'private', activity_domain: 'E', israa_shared: false }),
    school2027Row({ row_id: 'public', activity_domain: 'E', israa_shared: true })
  ], { activity_period: 'school_2027', include_inactive: true });

  assert.deepEqual(rows.map((row) => row.row_id), ['public']);
});
