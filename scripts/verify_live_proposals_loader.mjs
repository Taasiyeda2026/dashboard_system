/**
 * One-off live verification for the proposals-agreements Supabase loader.
 * Run: node scripts/verify_live_proposals_loader.mjs [email] [entry_code]
 * Without credentials it runs unauthenticated (RLS returns empty reference data).
 */
const storageStub = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
};
globalThis.sessionStorage = storageStub();
globalThis.localStorage = storageStub();
globalThis.window = globalThis.window || { addEventListener: () => {}, location: { href: 'http://localhost/' } };
globalThis.document = globalThis.document || { addEventListener: () => {}, querySelector: () => null };

const { state } = await import('../frontend/src/state.js');
const { supabase } = await import('../frontend/src/supabase-client.js');
const { api } = await import('../frontend/src/api.js');

const [email, entryCode] = process.argv.slice(2);
if (email && entryCode) {
  const authEmail = email.includes('@') ? email : `${email}@think.org.il`;
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: entryCode });
  if (error) {
    console.error('AUTH FAILED:', error.message);
    process.exit(1);
  }
  console.log('authenticated as', data.user?.email);
} else {
  console.log('running UNAUTHENTICATED (anon) — reference tables are RLS-protected and will come back empty');
}

state.user = { display_role: 'admin', role: 'admin', user_id: 'verify' };

const data = await api.proposalsAgreements();
console.log('loader keys:', Object.keys(data).join(', '));
console.log('proposalActivityGroups:', JSON.stringify(data.proposalActivityGroups, null, 1));
console.log('proposalGroupAliases count:', (data.proposalGroupAliases || []).length);
console.log('aliases:', JSON.stringify((data.proposalGroupAliases || []).map((a) => `${a.alias_name}→${a.group_key}`)));
const pricing = data.proposalActivityPricing || [];
console.log('pricing rows:', pricing.length);
const sample = pricing.slice(0, 3).map((r) => ({ name: r.activity_name, proposal_group: r.proposal_group, group_key: r.group_key, template_key: r.template_key }));
console.log('pricing sample:', JSON.stringify(sample));
const badPricing = pricing.filter((r) => r.proposal_group && !['summer', 'next_year', 'combined'].includes(r.group_key));
console.log('pricing rows NOT normalized to logical key:', badPricing.length, JSON.stringify([...new Set(badPricing.map((r) => r.proposal_group))]));
console.log('rows:', (data.rows || []).length);
console.log('row groups:', JSON.stringify([...new Set((data.rows || []).map((r) => r.activity_type_group))]));
console.log('template sections:', (data.proposalTemplateSections || []).length, 'template keys:', JSON.stringify([...new Set((data.proposalTemplateSections || []).map((s) => s.template_key))]));
process.exit(0);
