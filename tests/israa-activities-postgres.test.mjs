import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.ISRAA_TEST_DATABASE_URL;
const IDS = {
  admin: '11111111-1111-1111-1111-111111111111', denied: '22222222-2222-2222-2222-222222222222',
  tracking: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', proposalE: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  proposalY: 'cccccccc-cccc-cccc-cccc-cccccccccccc', item: 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  , itemFallback: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', itemOther: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
};

async function authenticate(client, uid) {
  await client.query("select set_config('test.uid', $1, false)", [uid]);
}

test('real Postgres Israa RPC flow enforces permission, group idempotency, E ownership and the Y guard', async (t) => {
  if (!connectionString) {
    t.skip('set ISRAA_TEST_DATABASE_URL to a disposable Postgres database to run the Israa integration contract');
    return;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
    await client.query(await readFile(new URL('./fixtures/israa-activities-stub-schema.sql', import.meta.url), 'utf8'));
    for (const role of ['authenticated', 'anon', 'service_role']) {
      await client.query(`do $$ begin if not exists (select from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
    }
    await client.query(await readFile(new URL('../supabase/migrations/20260823193000_israa_private_activity_flow.sql', import.meta.url), 'utf8'));
    await client.query(await readFile(new URL('../supabase/migrations/20260825120000_prefill_israa_activity_drafts.sql', import.meta.url), 'utf8'));
    await client.query(await readFile(new URL('../supabase/migrations/20260824011500_israa_remove_private_activity_draft.sql', import.meta.url), 'utf8'));
    await client.query(`create trigger trg_guard_proposal_linked_activity_domain_y before insert or update of proposal_agreement_id, proposal_item_id on public.activities for each row execute function public.guard_proposal_linked_activity_domain_y()`);
    await client.query(`insert into users values ('israa',$1,'authorized_user',true,'{"view_israa_management":"yes"}'),('denied',$2,'authorized_user',true,'{}')`, [IDS.admin, IDS.denied]);
    await client.query(`insert into proposals_agreements values ($1,10,20,'איש קשר','050','', 'a@example.test','', 'E'),($2,10,20,'איש קשר','050','','y@example.test','','Y')`, [IDS.proposalE, IDS.proposalY]);
    await client.query(`insert into proposal_agreement_items values
      ($1,$4,'סדנה','A-1','G-1','סדנת בדיקה',8,18400,9200,2),
      ($2,$4,'קורס','A-2','','קורס חישוב',12,15000,null,3),
      ($3,$4,'סיור','A-3','G-3','סיור אחר',1,700,700,1)`, [IDS.item, IDS.itemFallback, IDS.itemOther, IDS.proposalE]);
    await client.query(`insert into israa_program_tracking (id,proposal_agreement_id,proposal_items,authority,authority_id,school_name,school_id,contact_person,phone,email,selected_activity_drafts)
      values ($1,$2,$3,'רשות',10,'בית ספר',20,'איש קשר','050','a@example.test','[]')`, [IDS.tracking, IDS.proposalE, JSON.stringify([
        { proposal_item_id: IDS.item, program_name: 'סדנת בדיקה', item_type: 'סדנה', quantity: 2 },
        { proposal_item_id: IDS.itemFallback, program_name: 'קורס חישוב', item_type: 'קורס', quantity: 3 },
        { proposal_item_id: IDS.itemOther, program_name: 'סיור אחר', item_type: 'סיור', quantity: 1 }
      ])]);

    await client.query('grant usage on schema public to authenticated; grant select, insert, update on public.activities to authenticated');
    await client.query('set role authenticated');

    await authenticate(client, IDS.denied);
    await assert.rejects(client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]), /israa_management_forbidden/);
    await authenticate(client, IDS.admin);
    const selected = await client.query(`select public.save_israa_activity_draft($1,$2,'{}') draft`, [IDS.tracking, IDS.item]);
    assert.deepEqual(selected.rows[0].draft, {
      proposal_item_id: IDS.item, program_name: 'סדנת בדיקה', gefen_number: 'G-1', quantity: 2,
      activity_type: 'workshop', activity_name: 'סדנת בדיקה', activity_no: 'A-1', price: 9200,
      funding: 'גפן', contact_name: 'איש קשר', contact_phone: '050', contact_email: 'a@example.test', sessions: '8'
    });
    await client.query(`select public.save_israa_activity_draft($1,$2,'{"contact_name":"נערך","price":"9100","funding":"רשות"}')`, [IDS.tracking, IDS.item]);
    await client.query(`select public.save_israa_activity_draft($1,$2,'{}')`, [IDS.tracking, IDS.itemFallback]);
    await client.query(`select public.save_israa_activity_draft($1,$2,'{}')`, [IDS.tracking, IDS.itemOther]);
    await client.query('select public.remove_israa_activity_draft($1,$2)', [IDS.tracking, IDS.itemOther]);
    await client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]);
    await client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]);
    await client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.itemFallback]);
    const shared = await client.query('select israa_source_item_id, activity_name, activity_type, activity_no, gefen_number, sessions, price, funding, israa_group_number, authority_id, school_id, contact_name, contact_phone, contact_email from activities where israa_tracking_id=$1 order by israa_source_item_id, israa_group_number', [IDS.tracking]);
    assert.equal(shared.rowCount, 5);
    const workshopRows = shared.rows.filter((row) => row.israa_source_item_id === IDS.item);
    const fallbackRows = shared.rows.filter((row) => row.israa_source_item_id === IDS.itemFallback);
    assert.equal(workshopRows.length, 2);
    assert.ok(workshopRows.every((row) => row.activity_name === 'סדנת בדיקה' && row.activity_type === 'workshop' && row.activity_no === 'A-1' && row.gefen_number === 'G-1' && row.sessions === '8' && row.price === '9100' && row.funding === 'רשות' && row.contact_name === 'נערך' && row.contact_phone === '050' && row.contact_email === 'a@example.test'));
    assert.equal(fallbackRows.length, 3);
    assert.ok(fallbackRows.every((row) => row.activity_name === 'קורס חישוב' && row.activity_type === 'course' && row.activity_no === 'A-2' && row.gefen_number === null && row.sessions === '12' && row.price === '5000' && row.funding === null));
    assert.ok(shared.rows.every((row) => row.authority_id === '10' && row.school_id === '20'));

    await assert.rejects(client.query(`insert into activities(row_id,activity_domain,proposal_agreement_id,israa_tracking_id,israa_source_item_id,israa_group_number) values ('forged','E',$1,$2,$3,9)`, [IDS.proposalE, IDS.tracking, IDS.item]), /israa_provenance_write_forbidden/);
    await client.query('reset role');
    await client.query(`update israa_program_tracking set proposal_items='[]' where id=$1`, [IDS.tracking]);
    await client.query('set role authenticated');
    await assert.rejects(client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]), /proposal_item_not_in_israa_tracking/);

    await client.query(`insert into activities(row_id,activity_domain,status) values ('plain-y','Y','פתוח'),('plain-e','E','פתוח')`);
    await assert.rejects(client.query(`select public.update_israa_shared_activity('plain-y','{"notes":"x"}')`), /israa_activity_edit_forbidden/);
    await assert.rejects(client.query(`select public.update_israa_shared_activity('plain-e','{"notes":"x"}')`), /israa_activity_edit_forbidden/);
    await client.query(`insert into activities(row_id,activity_domain,proposal_agreement_id) values ('proposal-y','Y',$1)`, [IDS.proposalY]);
    await assert.rejects(client.query(`insert into activities(row_id,activity_domain,proposal_agreement_id) values ('proposal-e','E',$1)`, [IDS.proposalE]), /proposal_domain_not_routed_to_activities/);
  } finally {
    await client.end();
  }
});
