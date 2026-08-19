import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildProposalOperationalNameIndex,
  operationalProposalName
} = await import('../frontend/src/proposal-operational-name-runtime.js');

test('known catalog programs display the operational short name by stable activity number', () => {
  const index = buildProposalOperationalNameIndex([
    {
      list_id: 30,
      activity_no: '9545',
      gefen_number: '9545',
      value: '9545',
      activity_name: 'סודות ויסודות הבינה המלאכותית'
    },
    {
      list_id: 33,
      activity_no: '53819',
      gefen_number: '53819',
      value: '53819',
      activity_name: 'יישומי הבינה המלאכותית'
    },
    {
      list_id: 40,
      activity_no: '60025',
      gefen_number: '',
      value: '60025',
      activity_name: 'תמיר - המחזור מתחיל בבית'
    }
  ], [
    {
      gefen_number: '9545',
      short_name: 'בינה מלאכותית',
      full_name: 'סודות ויסודות הבינה המלאכותית',
      is_active: true
    },
    {
      gefen_number: '53819',
      short_name: 'יישומי AI בשיתוף GOOGLE',
      full_name: 'יישומי הבינה המלאכותית',
      is_active: true
    }
  ]);

  assert.equal(operationalProposalName({ activity_no: '9545', item_name: 'שם ישן' }, index), 'בינה מלאכותית');
  assert.equal(operationalProposalName({ activity_no: '53819' }, index), 'יישומי AI בשיתוף GOOGLE');
  assert.equal(operationalProposalName({ activity_no: '60025' }, index), 'תמיר - המחזור מתחיל בבית');
  assert.equal(index.aliases.get('סודות ויסודות הבינה המלאכותית'), 'בינה מלאכותית');
});

test('free-text proposal items keep their own name when they have no catalog identity', () => {
  const index = buildProposalOperationalNameIndex([], []);
  assert.equal(
    operationalProposalName({ item_name: 'פעילות מותאמת אישית' }, index),
    'פעילות מותאמת אישית'
  );
});
