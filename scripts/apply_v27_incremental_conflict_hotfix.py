from pathlib import Path

planner = Path('frontend/src/screens/course-scheduling-planning.js')
text = planner.read_text(encoding='utf-8')

replacements = []

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    text = text.replace(old, new, 1)
    replacements.append(label)

replace_once(
    "  if (rows.length <= 4) {\n    const complete = [];\n    const maxNodes = 100000;",
    "  if (rows.length <= 6) {\n    const complete = [];\n    const maxNodes = 500000;",
    'expand exact school bundle search to six rows'
)

helper_anchor = "export function optimizeSchoolDayPackingPass({\n"
if text.count(helper_anchor) != 1:
    raise SystemExit('optimizeSchoolDayPackingPass anchor missing')
helper = r'''function schoolPackingConflictFallback({
  group = {},
  rowsById,
  candidateDays = [],
  blockers = [],
  activityById = new Map(),
  routeClient = null
} = {}) {
  const allowedDays = new Set(candidateDays);
  const selectedChoices = [];
  let moved = 0;
  let recruitmentCount = 0;

  const items = [...(group.movableRows || [])]
    .map((row) => ({
      row,
      options: schoolPackingOptions(row, allowedDays)
        .filter((option) => text(option?.instructorEmpId))
        .sort((first, second) =>
          schoolPackingBundleCost([{ row, option: first }], group)
          - schoolPackingBundleCost([{ row, option: second }], group)
        )
    }))
    .sort((a, b) => a.options.length - b.options.length || text(a.row?.courseId).localeCompare(text(b.row?.courseId)));

  const fits = (candidateChoice) => {
    if (blockers.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    )) return false;
    return !selectedChoices.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    );
  };

  for (const item of items) {
    const row = item.row;
    const chosen = item.options.find((option) => fits({ row, option })) || null;
    if (chosen) {
      const replacement = {
        ...row,
        kind: 'proposal',
        status: row?.status || 'הצעת מערכת',
        instructorEmpId: text(chosen.instructorEmpId),
        instructorName: text(chosen.instructorName),
        startDate: text(chosen.startDate || chosen.meetings?.[0]?.date),
        endDate: text(chosen.endDate || chosen.meetings?.at?.(-1)?.date),
        startTime: text(chosen.startTime || chosen.meetings?.[0]?.start_time),
        endTime: text(chosen.endTime || chosen.meetings?.[0]?.end_time),
        meetings: (chosen.meetings || []).map((meeting) => ({ ...meeting })),
        diagnostics: {
          ...(row?.diagnostics || {}),
          schoolDayPacking: true,
          schoolFirstOptimized: true,
          schoolConflictFallback: true
        }
      };
      const current = schoolPackingCurrentOption(row);
      const changed = text(current?.instructorEmpId) !== text(chosen.instructorEmpId)
        || planningMeetingsSignature(current?.meetings) !== planningMeetingsSignature(chosen.meetings);
      rowsById.set(text(row.courseId), replacement);
      selectedChoices.push({ row: replacement, option: schoolPackingCurrentOption(replacement) });
      if (changed) moved += 1;
      continue;
    }

    const scheduleCandidates = [
      ...(row?.scheduleOptions || []).map((option) => schoolPackingScheduleOption(row, option)),
      schoolPackingCurrentOption(row)
    ].filter(Boolean);
    const schedule = scheduleCandidates.find((option) => {
      const days = planningRowWeekdays(option);
      return days.size && [...days].every((day) => allowedDays.has(day));
    }) || scheduleCandidates[0] || null;
    if (!schedule) continue;

    const selectedSchedule = {
      startDate: text(schedule.startDate || schedule.meetings?.[0]?.date),
      endDate: text(schedule.endDate || schedule.meetings?.at?.(-1)?.date),
      startTime: text(schedule.startTime || schedule.meetings?.[0]?.start_time),
      endTime: text(schedule.endTime || schedule.meetings?.[0]?.end_time),
      meetings: (schedule.meetings || []).map((meeting) => ({ ...meeting }))
    };
    rowsById.set(text(row.courseId), {
      ...row,
      kind: 'recruitment',
      status: 'נדרש גיוס',
      instructorEmpId: '',
      instructorName: '',
      ...selectedSchedule,
      scheduleOptions: [
        selectedSchedule,
        ...(row?.scheduleOptions || []).filter((candidate) =>
          planningMeetingsSignature(candidate?.meetings) !== planningMeetingsSignature(selectedSchedule.meetings)
        )
      ],
      diagnostics: {
        ...(row?.diagnostics || {}),
        schoolDayPacking: true,
        schoolFirstOptimized: true,
        schoolConflictFallback: true,
        staffBundleComplete: false
      },
      reason: 'לא נמצאה חבילת צוות קיים ללא חפיפה לכל פעילויות בית הספר; לוח בית הספר נשמר ונדרשת השלמת מדריך.'
    });
    recruitmentCount += 1;
    moved += 1;
  }

  return { moved, recruitmentCount };
}

'''
text = text.replace(helper_anchor, helper + helper_anchor, 1)
replacements.append('add conflict-safe school fallback')

old = """    if (shouldApply) {
      for (const { row, option } of solution.choices) {"""
new = """    let staffConflictFallbackCount = 0;
    if (!solution && currentHasConflict) {
      const fallback = schoolPackingConflictFallback({
        group: originalGroup,
        rowsById,
        candidateDays,
        blockers,
        activityById,
        routeClient
      });
      moved += fallback.moved;
      staffConflictFallbackCount = fallback.recruitmentCount;
    }

    if (shouldApply) {
      for (const { row, option } of solution.choices) {"""
replace_once(old, new, 'invoke school conflict fallback')

old = """    annotateSchoolPlanningGroup(refreshed, minimum, alternatives);
  }
  return { moved, groups: groups.length };"""
new = """    const schoolPlanning = annotateSchoolPlanningGroup(refreshed, minimum, alternatives);
    const staffBundleComplete = !(currentHasConflict && !solution) && staffConflictFallbackCount === 0;
    for (const row of refreshed.rows || []) {
      row.schoolPlanning = {
        ...(row.schoolPlanning || schoolPlanning),
        staffBundleComplete,
        staffConflictFallbackCount
      };
    }
  }
  return { moved, groups: groups.length };"""
replace_once(old, new, 'record staff bundle completeness')

old = """      targetCourseIds: optimizationOnlyIds ? [...optimizationOnlyIds] : null,
      targets,"""
new = """      targetCourseIds: optimizationOnlyIds
        ? [...optimizationOnlyIds]
        : (incrementalIds ? [...incrementalIds] : null),
      targets,"""
replace_once(old, new, 'scope gap compaction to incremental ids')

planner.write_text(text, encoding='utf-8')

# Add focused regressions.
test_path = Path('tests/course-scheduling-school-packing-option-coverage.test.mjs')
test_text = test_path.read_text(encoding='utf-8')
insert_anchor = "test('v27 upgrade rebuilds both flexible proposals and recruitment rows for school-first optimization', () => {"
if test_text.count(insert_anchor) != 1:
    raise SystemExit('test insertion anchor missing')
new_tests = r'''test('five-row school conflict never leaves overlapping proposals when existing staff cannot cover the full bundle', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const activities = ids.map((row_id) => ({
    row_id, school_id: 'school-379', school: 'מקיף ערבי', activity_type: 'course'
  }));
  const rowsById = new Map(ids.map((courseId) => [courseId, {
    courseId,
    schoolId: 'school-379',
    school: 'מקיף ערבי',
    courseName: 'בינה מלאכותית',
    kind: 'proposal',
    instructorEmpId: '1537',
    instructorName: 'יארא',
    startDate: '2026-10-13',
    endDate: '2026-12-08',
    startTime: '12:00',
    endTime: '13:30',
    meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }],
    packingOptions: [
      option('1537', '2026-10-13', '12:00', '13:30'),
      option('1529', '2026-10-17', '08:00', '09:30'),
      option('1529', '2026-10-17', '08:30', '10:00')
    ],
    scheduleOptions: [
      { startDate: '2026-10-12', endDate: '2026-12-07', startTime: '10:00', endTime: '11:30', meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }] },
      { startDate: '2026-10-13', endDate: '2026-12-08', startTime: '12:00', endTime: '13:30', meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }] }
    ]
  }]));

  optimizeSchoolDayPackingPass({ rowsById, activities });
  const proposals = [...rowsById.values()].filter((row) => row.kind === 'proposal');
  const recruitments = [...rowsById.values()].filter((row) => row.kind === 'recruitment');
  assert.ok(recruitments.length >= 1);
  assert.equal(rowsById.get('a').schoolPlanning.staffBundleComplete, false);
  assert.equal(rowsById.get('a').schoolPlanning.staffConflictFallbackCount, recruitments.length);

  for (let i = 0; i < proposals.length; i += 1) {
    for (let j = i + 1; j < proposals.length; j += 1) {
      const first = proposals[i];
      const second = proposals[j];
      if (first.instructorEmpId !== second.instructorEmpId) continue;
      const a = first.meetings[0];
      const b = second.meetings[0];
      if (a.date !== b.date) continue;
      const overlap = a.start_time < b.end_time && b.start_time < a.end_time;
      assert.equal(overlap, false, `${first.courseId} overlaps ${second.courseId}`);
    }
  }
});

test('incremental updates scope gap compaction to incremental ids instead of scanning all proposals', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /targetCourseIds:\s*optimizationOnlyIds[\s\S]*?incrementalIds \? \[\.\.\.incrementalIds\] : null/);
});

'''
test_text = test_text.replace(insert_anchor, new_tests + insert_anchor, 1)
test_path.write_text(test_text, encoding='utf-8')

sw = Path('frontend/sw.js')
sw_text = sw.read_text(encoding='utf-8')
if 'const CACHE_VERSION = 1876;' not in sw_text:
    raise SystemExit('service worker cache anchor missing')
sw.write_text(sw_text.replace('const CACHE_VERSION = 1876;', 'const CACHE_VERSION = 1877;', 1), encoding='utf-8')

index = Path('index.html')
index_text = index.read_text(encoding='utf-8')
old_marker = './frontend/src/screens/course-scheduling-compact-layout.js?v=20261004-planning-v27-school-first'
new_marker = './frontend/src/screens/course-scheduling-compact-layout.js?v=20261004-v27-incremental-conflict-repair'
if old_marker not in index_text:
    raise SystemExit('index cache marker missing')
index.write_text(index_text.replace(old_marker, new_marker, 1), encoding='utf-8')

print('Applied:', ', '.join(replacements))
