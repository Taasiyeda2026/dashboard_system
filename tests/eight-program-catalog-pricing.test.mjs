import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const catalogPath = 'frontend/public/catalog/summercatalog/catalog-data.json';
const adminPath = 'frontend/public/catalog/summercatalog/catalog-admin-data.json';
const editorPath = 'frontend/public/proposals/Proposaleditor.html';

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')).programs;
const adminCatalog = JSON.parse(readFileSync(adminPath, 'utf8')).programs;
const editor = readFileSync(editorPath, 'utf8');

const targetPricing = {
  '6089': [11, 16.5, 600, 9900],
  '57651': [10, 15, 633, 9500],
  '9545': [8, 12.5, 640, 8000],
  '53828': [10, 15, 633, 9500],
  '53819': [10, 15, 633, 9500],
  '46091': [14, 21, 571, 12000],
  '3604': [14, 21, 571, 12000],
  '52279': [14, 21, 643, 13500],
};

function program(programs, activityNo) {
  return programs.find((item) => item.activityNo === activityNo);
}

function schoolCatalogFromEditor() {
  const match = editor.match(/const SCHOOL_CATALOG = (\[[\s\S]*?\n\]);/);
  assert.ok(match, 'SCHOOL_CATALOG declaration must be present');
  return vm.runInNewContext(match[1]);
}

test('public catalog exposes the required meeting counts', () => {
  for (const [activityNo, [meetings]] of Object.entries(targetPricing)) {
    const item = program(catalog, activityNo);
    assert.ok(item, `missing public catalog program ${activityNo}`);
    assert.equal(item.sessions, `${meetings} מפגשים`);
  }
});

test('6089 public and admin syllabi contain the escape room as meeting 6', () => {
  for (const programs of [catalog, adminCatalog]) {
    const item = program(programs, '6089');
    assert.equal(item.syllabus.length, 11);
    assert.deepEqual(item.syllabus.map((row) => row.n), Array.from({ length: 11 }, (_, i) => String(i + 1)));
    assert.deepEqual(item.syllabus[5], {
      n: '6',
      topic: 'חדר בריחה',
      desc: 'מפגש ייחודי המשלב משחק קבוצתי ולמידה חווייתית ומרחיב את החשיבה היצירתית לקראת פיתוח מוצר.',
    });
  }
});

test('57651 has the replacement syllabus and no model or prototype terms', () => {
  const item = program(catalog, '57651');
  assert.equal(item.syllabus.length, 10);
  assert.equal(item.syllabus.at(-1).topic, 'הצגה וסיכום');
  assert.equal(item.outcome, 'פוסטר חקר טכנולוגי\nפרזנטציה\nהצגת הפתרון');
  const activeProgramSource = JSON.stringify(item);
  for (const term of ['דגם', 'דגמים', 'דגם ראשוני', 'דגם פיזי', 'אב-טיפוס', 'אב־טיפוס', 'אב טיפוס', 'אבטיפוס']) {
    assert.equal(activeProgramSource.includes(term), false, `57651 still contains ${term}`);
  }
});

test('3604 and 52279 contain only their designated inserted meeting topics', () => {
  const portzot = program(catalog, '3604');
  assert.equal(portzot.syllabus.length, 14);
  assert.equal(portzot.syllabus[6].topic, 'מחליטות ומובילות');
  assert.equal(portzot.syllabus[9].topic, 'חושבות כלכלית');

  const premium = program(catalog, '52279');
  assert.equal(premium.syllabus.length, 14);
  assert.equal(premium.syllabus[9].topic, 'המיזם במספרים');
  assert.equal(premium.syllabus[11].topic, 'חדר העסקאות');
});

test('SCHOOL_CATALOG keeps authoritative initial totals independent of rounded hourly prices', () => {
  const schoolCatalog = schoolCatalogFromEditor();
  for (const [gapan, [meetings, hours, pricePerHour, price]] of Object.entries(targetPricing)) {
    const item = schoolCatalog.find((entry) => entry.gapan === gapan);
    assert.ok(item, `missing SCHOOL_CATALOG program ${gapan}`);
    assert.deepEqual(
      [item.meetings, item.groups, item.hours, item.pricePerHour, item.price],
      [meetings, 1, hours, pricePerHour, price],
    );
  }
  assert.notEqual(633 * 15, schoolCatalog.find((item) => item.gapan === '57651').price);
  assert.notEqual(571 * 21, schoolCatalog.find((item) => item.gapan === '3604').price);
  assert.notEqual(643 * 21, schoolCatalog.find((item) => item.gapan === '52279').price);
});
