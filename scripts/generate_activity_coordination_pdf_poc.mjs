import React from 'react';
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToFile } from '@react-pdf/renderer';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActivityDocumentSnapshot } from '../frontend/src/activity-coordination/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = path.join(root, 'frontend/assets/fonts');
const outputDir = path.join(root, 'artifacts/activity-coordination-pdf-poc');
const h = React.createElement;

for (const [src, fontWeight] of [['Arimo-Regular.ttf', 400], ['Arimo-Medium.ttf', 500], ['Arimo-SemiBold.ttf', 600], ['Arimo-Bold.ttf', 700]]) {
  Font.register({ family: 'Arimo', src: path.join(fontDir, src), fontWeight });
}
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: { fontFamily: 'Arimo', fontSize: 9, paddingTop: 28, paddingRight: 34, paddingBottom: 34, paddingLeft: 34, direction: 'rtl', color: '#172033' },
  logo: { width: 108, alignSelf: 'flex-end', marginBottom: 6 },
  title: { fontWeight: 700, fontSize: 18, color: '#153e75', textAlign: 'center', marginVertical: 10 },
  programTitle: { fontWeight: 700, fontSize: 14, color: '#1d4ed8', textAlign: 'right', marginTop: 8, marginBottom: 5 },
  sectionTitle: { fontWeight: 600, fontSize: 11, color: '#1e3a5f', textAlign: 'right', marginTop: 8, marginBottom: 4 },
  detailRow: { flexDirection: 'row-reverse', justifyContent: 'flex-start', marginBottom: 2 },
  detailLabel: { width: 125, fontWeight: 500, textAlign: 'right' },
  detailValue: { flexGrow: 1, textAlign: 'right' },
  intro: { textAlign: 'right', marginTop: 7, marginBottom: 5 },
  table: { borderTopWidth: 0.7, borderRightWidth: 0.7, borderColor: '#64748b' },
  row: { flexDirection: 'row-reverse', borderBottomWidth: 0.7, borderColor: '#64748b', minHeight: 27 },
  headerRow: { backgroundColor: '#dbeafe' },
  cell: { borderLeftWidth: 0.7, borderColor: '#64748b', padding: 4, textAlign: 'right', justifyContent: 'center' },
  headerCell: { fontWeight: 600, fontSize: 8.2 },
  meeting: { width: '7%' }, date: { width: '13%' }, day: { width: '11%' }, grade: { width: '15%' }, hours: { width: '14%' }, preparation: { width: '40%' },
  contacts: { marginTop: 7, borderTopWidth: 0.6, borderColor: '#94a3b8' },
  contactRow: { flexDirection: 'row-reverse', borderBottomWidth: 0.6, borderColor: '#cbd5e1', paddingVertical: 3 },
  contactRole: { width: '42%', fontWeight: 600, textAlign: 'right' },
  contactName: { width: '33%', textAlign: 'right' },
  contactPhone: { width: '25%', textAlign: 'left', direction: 'ltr' },
  highlights: { marginTop: 7 },
  highlight: { flexDirection: 'row-reverse', marginBottom: 5 },
  highlightNumber: { width: 18, marginLeft: 6, fontWeight: 600, textAlign: 'right' },
  highlightText: { flexGrow: 1, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 13, left: 0, right: 0, textAlign: 'center', color: '#64748b', fontSize: 8 }
});

const highlights = [
  'במפגשים שבהם נדרשת כיתת מחשבים, מעבדה, מקרן, חיבור לאינטרנט או ציוד ייעודי אחר, יש לוודא מראש כי הציוד זמין, תקין ומוכן לשימוש.',
  'במהלך המפגשים נדרשת נוכחות של איש/אשת צוות חינוכי מטעם בית הספר.',
  'כל שינוי במועד, בשעה או במתכונת הפעילות יש לתאם מראש עם תעשיידע ורצוי לפחות 3 ימי עבודה מראש. ביטול או שינוי פחות מ-48 שעות לפני המפגש יחייב אישור בכתב של מנהל/ת בית הספר ויטופלו בהתאם להזמנה המאושרת ולהוראות הגפ"ן.'
];

const detail = (label, value) => h(View, { style: styles.detailRow }, h(Text, { style: styles.detailLabel }, label), h(Text, { style: styles.detailValue }, String(value || '')));
const tableCell = (value, style) => h(View, { style: [styles.cell, style] }, h(Text, null, String(value ?? '')));
const tableHeader = () => h(View, { style: [styles.row, styles.headerRow], wrap: false },
  tableCell('מפגש', [styles.meeting, styles.headerCell]), tableCell('תאריך', [styles.date, styles.headerCell]),
  tableCell('יום', [styles.day, styles.headerCell]), tableCell('כיתה / קבוצה', [styles.grade, styles.headerCell]),
  tableCell('שעות', [styles.hours, styles.headerCell]), tableCell('היערכות', [styles.preparation, styles.headerCell]));
const meetingRow = (meeting) => h(View, { key: meeting.meeting_number, style: styles.row, wrap: false },
  tableCell(meeting.meeting_number, styles.meeting), tableCell(meeting.date, [styles.date, { direction: 'ltr', textAlign: 'center' }]),
  tableCell(meeting.day, styles.day), tableCell(meeting.grade_class, styles.grade),
  tableCell(meeting.hours, [styles.hours, { direction: 'ltr', textAlign: 'center' }]), tableCell(meeting.school_preparation, styles.preparation));

function pageForChunk({ snapshot, chunk, pageIndex, totalPrograms, logo, continuation, showHighlights }) {
  return h(Page, { key: `${snapshot.program.activity_no}-${pageIndex}`, size: 'A4', style: styles.page },
    !continuation && pageIndex === 0 ? h(Image, { src: logo, style: styles.logo }) : null,
    !continuation && pageIndex === 0 ? h(React.Fragment, null,
      h(Text, { style: styles.sectionTitle }, 'לכבוד'),
      detail('איש/אשת קשר בבית הספר', snapshot.contact.name), detail('תפקיד', snapshot.contact.role), detail('טלפון', snapshot.contact.phone),
      h(Text, { style: styles.title }, totalPrograms === 1 ? 'סיכום פרטי פעילות' : 'סיכום תיאום פעילויות'),
      detail('בית הספר', snapshot.school.name), detail('סמל מוסד', snapshot.school.semel_mosad)) : null,
    h(Text, { style: styles.programTitle }, `${snapshot.program.name}${continuation ? ' — המשך' : ''}`),
    detail('מספר תוכנית', snapshot.program.activity_no), detail('מספר גפ״ן', snapshot.program.gefen_number), detail('מספר מפגשים', snapshot.program.sessions),
    h(Text, { style: styles.intro }, 'להלן מועדי הפעילות כפי שנקבעו ותואמו:'),
    h(View, { style: styles.table }, tableHeader(), ...chunk.map(meetingRow)),
    showHighlights ? h(React.Fragment, null,
      h(Text, { style: styles.sectionTitle }, 'אנשי קשר'),
      h(View, { style: styles.contacts },
        h(View, { style: styles.contactRow, wrap: false }, h(Text, { style: styles.contactRole }, 'מדריך/ה'), h(Text, { style: styles.contactName }, snapshot.instructor.name), h(Text, { style: styles.contactPhone }, snapshot.instructor.phone)),
        h(View, { style: styles.contactRow, wrap: false }, h(Text, { style: styles.contactRole }, 'מנהל/ת הפעילות מטעם תעשיידע'), h(Text, { style: styles.contactName }, snapshot.activity_manager.name), h(Text, { style: styles.contactPhone }, snapshot.activity_manager.phone))),
      h(Text, { style: styles.sectionTitle }, 'דגשים לפעילות'),
      h(View, { style: styles.highlights }, ...highlights.map((value, index) => h(View, { key: value, style: styles.highlight, wrap: false }, h(Text, { style: styles.highlightNumber }, `${index + 1}.`), h(Text, { style: styles.highlightText }, value))))) : null,
    h(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` })
  );
}

function CoordinationDocument({ snapshots, logo }) {
  const pages = [];
  snapshots.forEach((snapshot, programIndex) => {
    const meetings = snapshot.program.meetings || [];
    const chunkSize = meetings.some((row) => row.school_preparation.length > 100) ? 6 : 10;
    const chunks = Array.from({ length: Math.ceil(meetings.length / chunkSize) }, (_, index) => meetings.slice(index * chunkSize, (index + 1) * chunkSize));
    chunks.forEach((chunk, chunkIndex) => pages.push(pageForChunk({
      snapshot, chunk, pageIndex: pages.length, totalPrograms: snapshots.length, logo,
      continuation: programIndex > 0 || chunkIndex > 0,
      showHighlights: chunkIndex === chunks.length - 1
    })));
  });
  return h(Document, { title: snapshots.length === 1 ? 'סיכום פרטי פעילות' : 'סיכום תיאום פעילויות', author: 'תעשיידע' }, ...pages);
}

function sampleActivity(id, programName, programNumber, sessions, startDay = 3) {
  const row = { row_id: `poc-${id}`, school: 'בית הספר הרב-תחומי ע״ש יצחק רבין', semel_mosad: '540001', contact_name: 'יעל כהן', contact_role: 'רכזת חדשנות (STEM)', contact_phone: '050-1234567', activity_name: programName, activity_no: programNumber, gefen_number: `GFN-${77000 + id}`, sessions: String(sessions), start_time: '08:30:00', end_time: '10:00:00', grade: 'כיתה ח׳', class_group: `קבוצה ${id}`, emp_id: 9876, instructor_name: 'נועה לוי', activity_manager: 'הילה רוזן' };
  for (let meeting = 1; meeting <= sessions; meeting += 1) { const date = new Date(Date.UTC(2026, 8, startDay + ((meeting - 1) * 7))); row[`date_${meeting}`] = date.toISOString().slice(0, 10); }
  return row;
}
function syllabus(programNumber, sessions, long = false) { return Array.from({ length: sessions }, (_, index) => ({ program_number: programNumber, meeting_order: index + 1, school_preparation: index % 4 === 0 ? '' : long ? `יש להכין מראש מחשב לכל זוג תלמידים, חיבור יציב לאינטרנט, מקרן תקין ולוודא שניתן להפעיל קובצי English Lab (גרסה ${index + 1}) ללא הרשאות מנהל. במקרה של תקלה יש לעדכן את המדריכה לפחות יום לפני המפגש.` : index === 1 ? 'מחשבים עם חיבור לאינטרנט ומקרן תקין' : 'מחברות וכלי כתיבה' })); }
const snapshot = (activity, syllabusRows) => buildActivityDocumentSnapshot({ activity, syllabusRows, instructor: { mobile: '052-1112233' }, activityManager: { phone: '052-3222951' } });

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const logo = path.join(root, 'frontend/assets/invitations/logos/taasiyeda-logo.png');
const single = sampleActivity(1, 'יזמות באנגלית English Lab', 'P-100', 10);
const multi = [['מדע וטכנולוגיה – מסלול Alpha', 'P-201', 14, 3], ['יזמות וחדשנות English & Hebrew', 'P-202', 13, 4], ['רובוטיקה, תכנון ובנייה (מתקדמים)', 'P-203', 15, 5]].map(([name, number, sessions, day], index) => snapshot(sampleActivity(index + 2, name, number, sessions, day), syllabus(number, sessions, true)));
await renderToFile(h(CoordinationDocument, { snapshots: [snapshot(single, syllabus('P-100', 10))], logo }), path.join(outputDir, 'coordination-single-10-meetings.pdf'));
await renderToFile(h(CoordinationDocument, { snapshots: multi, logo }), path.join(outputDir, 'coordination-school-3-activities.pdf'));
console.log(outputDir);
