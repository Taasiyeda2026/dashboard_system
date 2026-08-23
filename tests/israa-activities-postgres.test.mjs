import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.ISRAA_TEST_DATABASE_URL;
const IDS = {
  admin: '11111111-1111-1111-1111-111111111111', denied: '22222222-2222-2222-2222-222222222222',
  tracking: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', proposalE: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  proposalY: 'cccccccc-cccc-cccc-cccc-cccccccccccc', item: 'dddddddd-dddd-dddd-dddd-dddddddddddd'
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
    await client.query(`create trigger trg_guard_proposal_linked_activity_domain_y before insert or update of proposal_agreement_id, proposal_item_id on public.activities for each row execute function public.guard_proposal_linked_activity_domain_y()`);
    await client.query(`insert into users values ('israa',$1,'authorized_user',true,'{"view_israa_management":"yes"}'),('denied',$2,'authorized_user',true,'{}')`, [IDS.admin, IDS.denied]);
    await client.query(`insert into proposals_agreements values ($1,10,20,'איש קשר','050','', 'a@example.test','', 'E'),($2,10,20,'איש קשר','050','','y@example.test','','Y')`, [IDS.proposalE, IDS.proposalY]);
    await client.query(`insert into proposal_agreement_items values ($1,$2,'סדנה','A-1','G-1','סדנת בדיקה',8,9000,1000)`, [IDS.item, IDS.proposalE]);
    await client.query(`insert into israa_program_tracking (id,proposal_agreement_id,proposal_items,authority,authority_id,school_name,school_id,contact_person,phone,email,selected_activity_drafts)
      values ($1,$2,$3,'רשות',10,'בית ספר',20,'איש קשר','050','a@example.test',$4)`, [IDS.tracking, IDS.proposalE, JSON.stringify([{ proposal_item_id: IDS.item, item_type: 'סדנה' }]), JSON.stringify([{ proposal_item_id: IDS.item, program_name: 'סדנת בדיקה', quantity: 3, activity_type: 'workshop', price: '9000', start_date: '2027-09-01', start_time: '09:00', end_time: '10:00' }])]);

    await client.query('grant usage on schema public to authenticated; grant select, insert, update on public.activities to authenticated');
    await client.query('set role authenticated');

    await authenticate(client, IDS.denied);
    await assert.rejects(client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]), /israa_management_forbidden/);
    await authenticate(client, IDS.admin);
    await client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]);
    await client.query('select public.share_israa_activity($1,$2)', [IDS.tracking, IDS.item]);
    const shared = await client.query('select activity_domain, activity_type, price, start_date, start_time, israa_group_number, authority_id, school_id, contact_name from activities where israa_tracking_id=$1 order by israa_group_number', [IDS.tracking]);
    assert.equal(shared.rowCount, 3);
    assert.deepEqual(shared.rows.map((row) => row.israa_group_number), [1, 2, 3]);
    assert.ok(shared.rows.every((row) => row.activity_domain === 'E' && row.activity_type === 'workshop' && row.price === '9000' && row.start_date.toISOString().startsWith('2027-09-01') && row.start_time === '09:00:00' && row.authority_id === '10' && row.school_id === '20' && row.contact_name === 'איש קשר'));

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
