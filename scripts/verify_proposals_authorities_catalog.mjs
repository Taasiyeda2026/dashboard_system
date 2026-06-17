/**
 * Live verification for proposals authority catalog (public.authorities).
 * Run: node scripts/verify_proposals_authorities_catalog.mjs
 */
const storageStub = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
};
globalThis.sessionStorage = storageStub();
globalThis.localStorage = storageStub();

const { supabase } = await import('../frontend/src/supabase-client.js');

const { data: authorities, error } = await supabase
  .from('authorities')
  .select('id,authority_name,authority_code,authority_type,district,active')
  .order('authority_name', { ascending: true });

if (error) {
  console.error('authorities query failed:', error.message);
  process.exit(1);
}

const ashkol = (authorities || []).find((row) => String(row.authority_name || '') === 'אשכול');
console.info('[verify-authorities]', {
  total: authorities?.length ?? 0,
  ashkol: ashkol || null
});

if (!ashkol) {
  console.error('FAIL: אשכול not found in public.authorities');
  process.exit(1);
}

const haystack = [
  ashkol.authority_name,
  ashkol.authority_code,
  ashkol.authority_type,
  ashkol.district
].map((v) => String(v ?? '').toLowerCase()).join(' ');

const searchMatch = haystack.includes('אשכול');
console.info('[verify-ui-search]', {
  searchMatch,
  expectedLabel: `אשכול · ${ashkol.authority_type} · ${ashkol.district} · קוד ${ashkol.authority_code}`
});

if (!searchMatch) {
  console.error('FAIL: אשכול would not match authority search haystack');
  process.exit(1);
}

console.log('OK: אשכול is readable from Supabase and matches catalog search fields');
