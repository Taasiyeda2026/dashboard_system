import test from 'node:test';
import assert from 'node:assert/strict';

const {
  newProposalContactCandidate,
  linkNewProposalContact,
  installNewProposalContactLink
} = await import('../frontend/src/proposal-new-contact-link-runtime.js');

function newSchoolProposal(overrides = {}) {
  return {
    client_type: 'school',
    client_name: 'חטיבת בארי',
    client_authority: 'ראש העין',
    school_framework: 'חטיבת בארי',
    authority_id: 325,
    school_id: 2837,
    semel_mosad: 444869,
    contact_school_id: null,
    contact_name: 'שירלי אברמסון',
    contact_role: 'מנהל/ת בית הספר',
    phone: '052-5219796',
    email: 'shirlyabr@gmail.com',
    _contact_original: {
      id: '',
      authority_id: 325,
      school_id: 2837,
      semel_mosad: 444869,
      client_name: 'חטיבת בארי',
      authority: 'ראש העין',
      school: 'חטיבת בארי',
      contact_name: 'שירלי אברמסון',
      contact_role: 'מנהל/ת בית הספר',
      mobile: '052-5219796',
      email: 'shirlyabr@gmail.com'
    },
    ...overrides
  };
}

test('new school proposal creates or resolves a contacts_schools row before proposal insert', async () => {
  const proposal = newSchoolProposal();
  let candidate;
  const linked = await linkNewProposalContact({}, proposal, {
    persistContact: async (_api, row) => {
      candidate = row;
      return { ...row, id: 987, source_id: 987, source_table: 'contacts_schools' };
    }
  });

  assert.equal(candidate.authority_id, 325);
  assert.equal(candidate.school_id, 2837);
  assert.equal(candidate.contact_name, 'שירלי אברמסון');
  assert.equal(candidate.mobile, '052-5219796');
  assert.equal(candidate.email, 'shirlyabr@gmail.com');
  assert.equal(linked.contact_school_id, 987);
  assert.equal(linked._contact_original.id, 987);
  assert.equal(linked._contact_original.source_table, 'contacts_schools');
});

test('existing contact link, edit/clone payloads and non-school clients do not create a contact', async () => {
  assert.equal(newProposalContactCandidate(newSchoolProposal({ contact_school_id: 44 })), null);
  assert.equal(newProposalContactCandidate(newSchoolProposal({ supersedes_proposal_id: 'old-proposal' })), null);
  assert.equal(newProposalContactCandidate(newSchoolProposal({ client_type: 'authority', school_id: null })), null);
  assert.equal(newProposalContactCandidate({ ...newSchoolProposal(), _contact_original: null }), null);
});

test('api wrapper links the contact exactly once and forwards the linked proposal payload', async () => {
  const forwarded = [];
  let contactWrites = 0;
  const targetApi = {
    addProposalAgreement: async (payload) => {
      forwarded.push(payload);
      return { ok: true, row: { ...payload, id: 'proposal-1' } };
    }
  };

  assert.equal(installNewProposalContactLink(targetApi, {
    persistContact: async (_api, row) => {
      contactWrites += 1;
      return { ...row, id: 654, source_id: 654, source_table: 'contacts_schools' };
    }
  }), true);
  assert.equal(installNewProposalContactLink(targetApi), false, 'runtime installation must be idempotent');

  const result = await targetApi.addProposalAgreement(newSchoolProposal());
  assert.equal(contactWrites, 1);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].contact_school_id, 654);
  assert.equal(result.row.contact_school_id, 654);
});

test('existing contacts_schools identity passes through without another contact write', async () => {
  let contactWrites = 0;
  const targetApi = {
    addProposalAgreement: async (payload) => ({ ok: true, row: payload })
  };
  installNewProposalContactLink(targetApi, {
    persistContact: async () => {
      contactWrites += 1;
      return { id: 999 };
    }
  });

  const payload = newSchoolProposal({ contact_school_id: 321 });
  const result = await targetApi.addProposalAgreement(payload);
  assert.equal(contactWrites, 0);
  assert.equal(result.row.contact_school_id, 321);
});
