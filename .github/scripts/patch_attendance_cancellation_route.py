from pathlib import Path

bridge_path = Path('frontend/src/payroll-attendance-v2-bridge.js')
bridge = bridge_path.read_text(encoding='utf-8')
anchor = """    sourceAttendanceRecordId: text(travel?.source_record_id),
    generationKind: travel ? 'travel_time_cancellation' : '',
    outboundTravelMinutes: travel?.outbound_travel_minutes ?? null,
"""
replacement = """    sourceAttendanceRecordId: text(travel?.source_record_id),
    generationKind: travel ? 'travel_time_cancellation' : '',
    originEntityKey: text(travel?.origin_entity_key),
    destinationEntityKey: text(travel?.destination_entity_key),
    routeOriginLabel: text(travel?.route_origin_label),
    routeOriginAddress: text(travel?.route_origin_address),
    routeDestinationLabel: text(travel?.route_destination_label),
    routeDestinationAddress: text(travel?.route_destination_address),
    returnToHome: travel?.return_to_home === true,
    returnDestinationLabel: text(travel?.return_destination_label),
    returnDestinationAddress: text(travel?.return_destination_address),
    routeContextStale: travel?.route_context_stale === true,
    outboundTravelMinutes: travel?.outbound_travel_minutes ?? null,
"""
if bridge.count(anchor) != 1:
    raise SystemExit(f'bridge anchor count={bridge.count(anchor)}')
bridge = bridge.replace(anchor, replacement)
bridge_path.write_text(bridge, encoding='utf-8')

manager_path = Path('frontend/src/screens/attendance-control.js')
manager = manager_path.read_text(encoding='utf-8')
start = manager.index('  if (autoCancellation) {', manager.index('const manualReportTable'))
end = manager.index('  const fields = [', start)
new_block = """  if (autoCancellation) {
    const calculated = source.calculatedCancellationMinutes != null ? minutesLabel(source.calculatedCancellationMinutes) : displayWorkHours(display);
    const finalValue = source.finalCancellationMinutes != null ? minutesLabel(source.finalCancellationMinutes) : displayWorkHours(display);
    const sourceLabel = row.program || row.school || 'פעילות מקור';
    const routeStale = source.routeContextStale === true;
    const routePoint = (label, address, fallback = '') => [txt(label) || fallback, txt(address)].filter(Boolean).join(' — ');
    const routeOrigin = routePoint(source.routeOriginLabel, source.routeOriginAddress, 'נקודת מוצא');
    const routeDestination = routePoint(source.routeDestinationLabel, source.routeDestinationAddress, row.school || row.program || 'יעד הפעילות');
    const returnDestination = routePoint(source.returnDestinationLabel, source.returnDestinationAddress, 'בית המדריך');
    const legFormula = (value) => {
      const minutes = Math.max(0, Math.round(Number(value) || 0));
      const eligible = Math.max(0, minutes - 45);
      return `${minutesLabel(minutes)} − 0:45 = ${minutesLabel(eligible)}`;
    };
    const routeRows = [
      ['מאיפה', routeOrigin || '—', '—', false, 'מידע'],
      ['לאיפה', routeDestination || '—', '—', false, 'מידע'],
      ['זמן נסיעה למקטע', minutesLabel(source.outboundTravelMinutes), '—', routeStale, routeStale ? '⚠ לחישוב מחדש' : 'מידע'],
      ['זמן מזכה במקטע', legFormula(source.outboundTravelMinutes), '—', routeStale, routeStale ? '⚠ לחישוב מחדש' : 'מידע']
    ];
    if (source.returnToHome === true) {
      routeRows.push(
        ['חזרה אל', returnDestination || 'בית המדריך', '—', false, 'מידע'],
        ['זמן חזרה', minutesLabel(source.returnTravelMinutes), '—', routeStale, routeStale ? '⚠ לחישוב מחדש' : 'מידע'],
        ['זמן מזכה בחזרה', legFormula(source.returnTravelMinutes), '—', routeStale, routeStale ? '⚠ לחישוב מחדש' : 'מידע']
      );
    }
    const rows = [
      ['סוג פעילות', 'ביטול זמן', 'ביטול זמן', false, '✓ תקין'],
      ['תאריך', dateLabel(row.date), dateLabel(row.date), false, '✓ תקין'],
      ['מקור הפעילות', sourceLabel, sourceLabel, false, '✓ תקין'],
      ...routeRows,
      ['ביטול זמן מחושב', calculated, calculated, routeStale, routeStale ? '⚠ לחישוב מחדש' : '✓ תקין'],
      ['ביטול זמן לאישור', calculated, finalValue, routeStale || !entryResolvedLabel(entry || {}), routeStale ? '⚠ לחישוב מחדש' : (!entryResolvedLabel(entry || {}) ? '⚠ לאישור' : '✓ תקין')]
    ].map(([label, left, right, issue, statusLabel]) => {
      const info = statusLabel === 'מידע';
      const statusClass = issue ? 'attendance-control__status-pill--issue' : info ? 'attendance-control__status-pill--info' : 'attendance-control__status-pill--ok';
      return `<tr class="${issue ? 'attendance-control__comparison-row--issue' : ''}"><th>${escapeHtml(label)}</th><td>${shown(left)}</td><td>${shown(right)}</td><td><span class="attendance-control__status-pill ${statusClass}">${statusLabel}</span></td></tr>`;
    }).join('');
    const override = source.manuallyOverridden ? `<p class="attendance-control__manual-note"><strong>ביטול זמן: ${escapeHtml(finalValue)}</strong><br>נערך ידנית${source.overrideByName ? ` על ידי ${escapeHtml(source.overrideByName)}` : ''}</p>` : `<p class="attendance-control__manual-note"><strong>ביטול זמן: ${escapeHtml(finalValue)}</strong><br>מחושב אוטומטית לפי רצף הנסיעות בפועל ביום הדיווח</p>`;
    const staleWarning = routeStale ? '<p class="attendance-control__missing-match">⚠ המסלול השתנה מאז החישוב. נדרש חישוב מסלול מחדש לפני אישור.</p>' : '';
    const sequenceNote = source.returnToHome === true ? '' : '<p class="attendance-control__manual-note">הנסיעה ממשיכה לפעילות הבאה באותו יום; חזרה לבית אינה מחושבת ברשומה זו.</p>';
    return `<div class="attendance-control__comparison-wrap"><p class="attendance-control__comparison-title">בדיקת ביטול זמן</p><table class="attendance-control__comparison-table attendance-control__manual-table"><thead><tr><th>פרמטר</th><th>חישוב מערכת</th><th>נתון לאישור</th><th>סטטוס</th></tr></thead><tbody>${rows}</tbody></table>${staleWarning}${sequenceNote}${override}</div>${attachmentsHtml(display)}`;
  }
"""
manager = manager[:start] + new_block + manager[end:]
manager_path.write_text(manager, encoding='utf-8')

test_path = Path('tests/attendance-travel-compensation.test.mjs')
test = test_path.read_text(encoding='utf-8')
read_anchor = "const migration = await readFile(new URL('../supabase/migrations/20260908100000_attendance_travel_compensation.sql', import.meta.url), 'utf8');\n"
read_replacement = read_anchor + "const routeMigration = await readFile(new URL('../supabase/migrations/20260916205500_attendance_cancellation_daily_route_audit.sql', import.meta.url), 'utf8');\nconst routeStaleMigration = await readFile(new URL('../supabase/migrations/20260916205600_attendance_daily_route_stale_tracking.sql', import.meta.url), 'utf8');\n"
if test.count(read_anchor) != 1:
    raise SystemExit('test migration read anchor missing')
test = test.replace(read_anchor, read_replacement)
test += r'''

test('manager cancellation audit exposes the actual route and 45-minute calculation per leg', () => {
  for (const field of ['routeOriginLabel','routeOriginAddress','routeDestinationLabel','routeDestinationAddress','returnToHome','returnDestinationLabel','returnDestinationAddress','routeContextStale']) {
    assert.match(bridge, new RegExp(field));
  }
  for (const label of ['מאיפה','לאיפה','זמן נסיעה למקטע','זמן מזכה במקטע','חזרה אל','זמן חזרה','זמן מזכה בחזרה','ביטול זמן מחושב','ביטול זמן לאישור']) {
    assert.match(manager, new RegExp(label));
  }
  assert.match(manager, /minutesLabel\(minutes\).*0:45/s);
  assert.match(manager, /רצף הנסיעות בפועל ביום הדיווח/);
  assert.match(manager, /נדרש חישוב מסלול מחדש לפני אישור/);
});

test('travel cancellation follows the actual physical attendance sequence for the report day', () => {
  assert.match(routeMigration, /report_date = s\.report_date/);
  assert.match(routeMigration, /order by r\.start_time nulls last, r\.end_time nulls last/);
  assert.match(routeMigration, /previous_point := last_point/);
  assert.match(routeMigration, /return_to_home := next_point is null/);
  assert.match(routeMigration, /DAILY_SEQUENCE_V2/);
  assert.match(routeMigration, /route_origin_label/);
  assert.match(routeMigration, /route_destination_label/);
  assert.match(routeMigration, /route_context_stale/);
  assert.match(routeStaleMigration, /av2_mark_day_travel_context_stale/);
  assert.match(routeStaleMigration, /old\.start_time is distinct from new\.start_time/);
  assert.match(edge, /const returnToHome = context\.return_to_home === true/);
  assert.match(edge, /const returnPromise = returnToHome/);
  assert.match(edge, /Promise\.resolve\(\{ distance_km: 0, duration_minutes: 0 \}\)/);
});
'''
test_path.write_text(test, encoding='utf-8')
