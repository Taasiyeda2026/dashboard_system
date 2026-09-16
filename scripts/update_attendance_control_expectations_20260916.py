from pathlib import Path

path = Path('tests/attendance-control.test.mjs')
text = path.read_text(encoding='utf-8')
old = """  assert.equal((html.match(/attendance-control__manual-table/g) || []).length, 261, 'every manual and unmatched report renders compact data');
  assert.match(html, /attendance-control__manual-table[\\s\\S]*<th>שעות שכר<\\/th>/, 'manual reports use the compact reported-data table');"""
new = """  assert.equal((html.match(/attendance-control__manual-table/g) || []).length, 4, 'only reports with meaningful reported values render a compact data table');
  assert.match(html, /attendance-control__manual-table[\\s\\S]*<th>שעות שכר<\\/th>/, 'manual reports with meaningful values use the compact reported-data table');"""
assert text.count(old) == 1, 'legacy compact-table expectation not found exactly once'
path.write_text(text.replace(old, new, 1), encoding='utf-8')
