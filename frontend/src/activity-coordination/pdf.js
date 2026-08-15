import React from 'react';
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';

const h = React.createElement;
if (typeof window !== 'undefined') {
  const fontFaces = [
    [new URL('../../assets/fonts/Arimo-Regular.ttf', import.meta.url).href, 400],
    [new URL('../../assets/fonts/Arimo-Medium.ttf', import.meta.url).href, 500],
    [new URL('../../assets/fonts/Arimo-SemiBold.ttf', import.meta.url).href, 600],
    [new URL('../../assets/fonts/Arimo-Bold.ttf', import.meta.url).href, 700]
  ];
  for (const [src, fontWeight] of fontFaces) Font.register({ family: 'Arimo', src, fontWeight });
}
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Arimo',
    fontSize: 9,
    paddingTop: 24,
    paddingRight: 38,
    paddingBottom: 30,
    paddingLeft: 38,
    direction: 'rtl',
    color: '#202936',
    lineHeight: 1.22
  },
  topHeader: {
    flexDirection: 'row',
    direction: 'ltr',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 7
  },
  logo: { width: 44, marginTop: 1 },
  recipientBlock: { flexGrow: 1, alignItems: 'flex-end', paddingLeft: 22, direction: 'rtl' },
  honor: { fontWeight: 600, fontSize: 9.5, textAlign: 'right', marginBottom: 2 },
  plain: { textAlign: 'right', marginBottom: 1.5 },
  title: {
    fontWeight: 700,
    fontSize: 15,
    color: '#1d4e89',
    textAlign: 'right',
    marginTop: 5,
    marginBottom: 8
  },
  schoolBlock: {
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#cbd5e1',
    paddingVertical: 6,
    marginBottom: 8
  },
  metaLine: { textAlign: 'right', marginBottom: 2 },
  metaLabel: { fontWeight: 600 },
  programTitle: {
    fontWeight: 700,
    fontSize: 11.5,
    color: '#1d4e89',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 5
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 4
  },
  table: {
    width: '100%',
    borderTopWidth: 0.55,
    borderRightWidth: 0.55,
    borderColor: '#64748b',
    marginTop: 5
  },
  row: { flexDirection: 'row-reverse', borderBottomWidth: 0.55, borderColor: '#64748b', minHeight: 18 },
  headerRow: { backgroundColor: '#e6eef7', minHeight: 20 },
  cell: {
    borderLeftWidth: 0.55,
    borderColor: '#64748b',
    paddingHorizontal: 3,
    paddingVertical: 2.4,
    justifyContent: 'center'
  },
  centeredCell: { textAlign: 'center' },
  preparationCell: { textAlign: 'right', fontSize: 8.2 },
  headerCell: { fontWeight: 600, fontSize: 8.3, textAlign: 'center' },
  meetingWithPreparation: { width: '9%' },
  dateWithPreparation: { width: '18%' },
  dayWithPreparation: { width: '14%' },
  hoursWithPreparation: { width: '17%' },
  preparation: { width: '42%' },
  meetingWithoutPreparation: { width: '11%' },
  dateWithoutPreparation: { width: '30%' },
  dayWithoutPreparation: { width: '22%' },
  hoursWithoutPreparation: { width: '37%' },
  managerLine: { textAlign: 'right', marginTop: 7, marginBottom: 2 },
  highlights: { marginTop: 2 },
  highlight: { flexDirection: 'row-reverse', alignItems: 'flex-start', marginBottom: 4 },
  highlightNumber: { width: 16, marginLeft: 4, fontWeight: 600, textAlign: 'right' },
  highlightText: { flex: 1, textAlign: 'right', lineHeight: 1.25 },
  footer: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 7.2
  }
});

const highlights = [
  'במפגשים שבהם נדרשת כיתת מחשבים, מעבדה, מקרן, חיבור לאינטרנט או ציוד ייעודי אחר, יש לוודא מראש כי הציוד זמין, תקין ומוכן לשימוש.',
  'במהלך המפגשים נדרשת נוכחות של איש/אשת צוות חינוכי מטעם בית הספר.',
  'כל שינוי במועד, בשעה או במתכונת הפעילות יש לתאם מראש עם תעשיידע ורצוי לפחות 3 ימי עבודה מראש. ביטול או שינוי פחות מ-48 שעות לפני המפגש יחייב אישור בכתב של מנהל/ת בית הספר ויטופל בהתאם להזמנה המאושרת ולהוראות הגפ"ן.'
];

const clean = (value) => String(value ?? '').trim();

const metaLine = (label, value, extraStyle = null) => {
  const normalized = clean(value);
  if (!normalized) return null;
  return h(Text, { style: [styles.metaLine, extraStyle].filter(Boolean) },
    h(Text, { style: styles.metaLabel }, `${label}: `),
    normalized
  );
};

const cell = (value, style, textStyle = null) => h(
  View,
  { style: [styles.cell, style] },
  h(Text, { style: textStyle }, String(value ?? ''))
);

function tableColumns(hasPreparation) {
  return hasPreparation
    ? {
        meeting: styles.meetingWithPreparation,
        date: styles.dateWithPreparation,
        day: styles.dayWithPreparation,
        hours: styles.hoursWithPreparation
      }
    : {
        meeting: styles.meetingWithoutPreparation,
        date: styles.dateWithoutPreparation,
        day: styles.dayWithoutPreparation,
        hours: styles.hoursWithoutPreparation
      };
}

function tableHeader(hasPreparation) {
  const columns = tableColumns(hasPreparation);
  const cells = [
    cell('מפגש', columns.meeting, styles.headerCell),
    cell('תאריך', columns.date, styles.headerCell),
    cell('יום', columns.day, styles.headerCell),
    cell('שעות', columns.hours, styles.headerCell)
  ];
  if (hasPreparation) cells.push(cell('היערכות', styles.preparation, styles.headerCell));
  return h(View, { style: [styles.row, styles.headerRow], wrap: false }, ...cells);
}

function meetingRow(meeting, hasPreparation) {
  const columns = tableColumns(hasPreparation);
  const cells = [
    cell(meeting.meeting_number, columns.meeting, styles.centeredCell),
    cell(meeting.date, columns.date, [styles.centeredCell, { direction: 'ltr' }]),
    cell(meeting.day, columns.day, styles.centeredCell),
    cell(meeting.hours, columns.hours, [styles.centeredCell, { direction: 'ltr' }])
  ];
  if (hasPreparation) cells.push(cell(meeting.school_preparation, styles.preparation, styles.preparationCell));
  return h(View, { key: meeting.meeting_number, style: styles.row, wrap: false }, ...cells);
}

function estimatedMeetingCost(meeting, hasPreparation) {
  if (!hasPreparation) return 1;
  const preparationLength = clean(meeting?.school_preparation).length;
  if (!preparationLength) return 1;
  return 1 + Math.min(1.8, preparationLength / 95);
}

export function chunkCoordinationMeetings(meetings = []) {
  const rows = Array.isArray(meetings) ? meetings : [];
  const hasPreparation = rows.some((row) => clean(row?.school_preparation));
  const chunks = [];
  let current = [];
  let cost = 0;
  let capacity = hasPreparation ? 13.5 : 18;

  for (const row of rows) {
    const rowCost = estimatedMeetingCost(row, hasPreparation);
    if (current.length && cost + rowCost > capacity) {
      chunks.push(current);
      current = [];
      cost = 0;
      capacity = hasPreparation ? 16 : 20;
    }
    current.push(row);
    cost += rowCost;
  }
  if (current.length) chunks.push(current);

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    while (last.length < 4 && previous.length > 6) last.unshift(previous.pop());
  }
  return { chunks: chunks.length ? chunks : [[]], hasPreparation };
}

function activityPages(snapshot, programIndex, totalPrograms, logo) {
  const meetings = snapshot.program.meetings || [];
  const { chunks, hasPreparation } = chunkCoordinationMeetings(meetings);

  return chunks.map((chunk, chunkIndex) => {
    const firstDocumentPage = programIndex === 0 && chunkIndex === 0;
    const firstActivityPage = chunkIndex === 0;
    const lastActivityPage = chunkIndex === chunks.length - 1;
    const gradeClass = clean(snapshot.program.meetings?.[0]?.grade_class);
    const instructor = [clean(snapshot.instructor.name), clean(snapshot.instructor.phone)].filter(Boolean).join(' - ');
    const manager = [clean(snapshot.activity_manager.name), clean(snapshot.activity_manager.phone)].filter(Boolean).join(' - ');

    return h(Page, { key: `${programIndex}-${chunkIndex}`, size: 'A4', style: styles.page },
      firstDocumentPage ? h(View, { style: styles.topHeader },
        h(Image, { src: logo, style: styles.logo }),
        h(View, { style: styles.recipientBlock },
          h(Text, { style: styles.honor }, 'לכבוד'),
          clean(snapshot.contact.name) ? h(Text, { style: styles.plain }, snapshot.contact.name) : null,
          clean(snapshot.contact.role) ? h(Text, { style: styles.plain }, snapshot.contact.role) : null,
          clean(snapshot.contact.phone) ? h(Text, { style: [styles.plain, { direction: 'ltr' }] }, snapshot.contact.phone) : null
        )
      ) : null,
      firstDocumentPage ? h(React.Fragment, null,
        h(Text, { style: styles.title }, totalPrograms === 1 ? 'סיכום תיאום פעילות' : 'סיכום תיאום פעילויות'),
        h(View, { style: styles.schoolBlock },
          metaLine('בית הספר', snapshot.school.name),
          metaLine('רשות', snapshot.school.authority)
        )
      ) : null,
      h(Text, { style: styles.programTitle }, `${snapshot.program.name}${chunkIndex ? ' - המשך' : ''}`),
      firstActivityPage ? h(React.Fragment, null,
        instructor ? metaLine('מדריך/ה', instructor) : null,
        gradeClass ? metaLine('כיתה / קבוצה', gradeClass) : null,
        h(Text, { style: styles.sectionTitle }, 'מועדי הפעילות')
      ) : null,
      h(View, { style: styles.table },
        tableHeader(hasPreparation),
        ...chunk.map((meeting) => meetingRow(meeting, hasPreparation))
      ),
      lastActivityPage ? h(React.Fragment, null,
        manager ? h(Text, { style: styles.managerLine }, `מנהל/ת הפעילות מטעם תעשיידע: ${manager}`) : null,
        h(Text, { style: styles.sectionTitle }, 'דגשים לפעילות'),
        h(View, { style: styles.highlights },
          ...highlights.map((value, index) => h(View, { key: value, style: styles.highlight, wrap: false },
            h(Text, { style: styles.highlightNumber }, `${index + 1}.`),
            h(Text, { style: styles.highlightText }, value)
          ))
        )
      ) : null,
      h(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` })
    );
  });
}

export function ActivityCoordinationDocument({ snapshots, logo }) {
  return h(
    Document,
    { title: snapshots.length === 1 ? 'סיכום תיאום פעילות' : 'סיכום תיאום פעילויות', author: 'תעשיידע' },
    ...snapshots.flatMap((snapshot, index) => activityPages(snapshot, index, snapshots.length, logo))
  );
}

export async function generateActivityCoordinationPdf(snapshots) {
  const logo = new URL('../../assets/invitations/logos/taasiyeda-logo.png', import.meta.url).href;
  return pdf(h(ActivityCoordinationDocument, { snapshots, logo })).toBlob();
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
