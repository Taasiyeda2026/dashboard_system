export const alias = 'אופק פרימיום (פורצות דרך)';
export const programs = [
  { id: 'portzot', item_name: 'פורצות דרך – יזמות, טכנולוגיה, הובלה והעצמה לבנות', item_type: 'קורס', gefen_number: '3604', activity_no: '3604', source_pricing_key: '3604', proposal_group: 'next_year', quantity: 1, meetings_count: 14, hours_count: 21, hourly_price: 571, unit_price: 12000, total_price: 12000, list_id: 11 },
  { id: 'premium', item_name: 'אופק פרימיום', item_type: 'קורס', gefen_number: '52279', activity_no: '52279', source_pricing_key: '52279', proposal_group: 'next_year', quantity: 1, meetings_count: 14, hours_count: 21, hourly_price: 643, unit_price: 13500, total_price: 13500, list_id: 12 }
];
export function configureGroups(s) {
  s.setProposalGroupLookups({ proposalActivityGroups: [
    { group_key: 'gefen', display_name: 'גפ״ן', template_key: 'gefen' },
    { group_key: 'next_year', display_name: 'תוכניות תשפ״ז', template_key: 'next_year' },
    { group_key: 'next_year_courses', display_name: 'קורסים ותוכניות', template_key: 'next_year' },
    { group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
    { group_key: 'combined', display_name: 'הצעה משולבת', template_key: 'combined', included_group_keys: ['summer', 'next_year'] }
  ] });
}
export function row(group, overrides = {}) {
  return { id: 'isolated-proposal', activity_type_group: group, document_type: 'הצעת מחיר', status: 'draft', proposal_date: '2026-10-12', school_framework: 'בית ספר לבדיקה', client_authority: 'סביבה מבודדת', quote_number: 'TEST-3604', ...overrides };
}
export function sections(group) {
  return [
    { template_key: group, section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: 'להלן הקורסים המוצעים לשנת הלימודים תשפ״ז:\n{{selected_course_short_names}}' },
    { template_key: group, section_key: 'intro', section_body: 'בדיקת מסמך הצעת מחיר' }
  ];
}
