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
  page: { fontFamily: 'Arimo', fontSize: 9.2, paddingTop: 28, paddingRight: 52, paddingBottom: 34, paddingLeft: 52, direction: 'rtl', color: '#202936', lineHeight: 1.25 },
  logo: { width: 70, alignSelf: 'flex-end', marginBottom: 8 },
  honor: { fontWeight: 600, fontSize: 10, textAlign: 'right', marginBottom: 3 },
  plain: { textAlign: 'right', marginBottom: 2 },
  title: { fontWeight: 700, fontSize: 15, color: '#1d4e89', textAlign: 'right', marginTop: 12, marginBottom: 10 },
  programTitle: { fontWeight: 600, fontSize: 11, color: '#1d4e89', textAlign: 'right', marginTop: 10, marginBottom: 5 },
  sectionTitle: { fontWeight: 600, fontSize: 10.5, textAlign: 'right', marginTop: 12, marginBottom: 5 },
  labelLine: { flexDirection: 'row-reverse', marginBottom: 2 },
  label: { fontWeight: 500, textAlign: 'right' },
  value: { textAlign: 'right' },
  table: { width: '88%', alignSelf: 'flex-end', borderTopWidth: 0.55, borderRightWidth: 0.55, borderColor: '#64748b', marginTop: 6 },
  row: { flexDirection: 'row-reverse', borderBottomWidth: 0.55, borderColor: '#64748b', minHeight: 21 },
  headerRow: { backgroundColor: '#dce8f5', minHeight: 22 },
  cell: { borderLeftWidth: 0.55, borderColor: '#64748b', paddingHorizontal: 3, paddingVertical: 3, textAlign: 'right', justifyContent: 'center' },
  headerCell: { fontWeight: 600, fontSize: 8.5 },
  meeting: { width: '9%' }, date: { width: '17%' }, day: { width: '13%' }, hours: { width: '17%' }, preparation: { width: '44%' },
  highlights: { marginTop: 3 },
  highlight: { flexDirection: 'row-reverse', marginBottom: 6 },
  highlightNumber: { width: 17, marginLeft: 4, fontWeight: 500, textAlign: 'right' },
  highlightText: { flexGrow: 1, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', color: '#64748b', fontSize: 7.5 }
});

const highlights = [
  'במפגשים שבהם נדרשת כיתת מחשבים, מעבדה, מקרן, חיבור לאינטרנט או ציוד ייעודי אחר, יש לוודא מראש כי הציוד זמין, תקין ומוכן לשימוש.',
  'במהלך המפגשים נדרשת נוכחות של איש/אשת צוות חינוכי מטעם בית הספר.',
  'כל שינוי במועד, בשעה או במתכונת הפעילות יש לתאם מראש עם תעשיידע ורצוי לפחות 3 ימי עבודה מראש. ביטול או שינוי פחות מ-48 שעות לפני המפגש יחייב אישור בכתב של מנהל/ת בית הספר ויטופלו בהתאם להזמנה המאושרת ולהוראות הגפ"ן.'
];

const line = (label, value) => h(View, { style: styles.labelLine }, h(Text, { style: styles.label }, `${label}: `), h(Text, { style: styles.value }, String(value || '')));
const cell = (value, style) => h(View, { style: [styles.cell, style] }, h(Text, null, String(value ?? '')));
const header = () => h(View, { style: [styles.row, styles.headerRow], wrap: false }, cell('מפגש', [styles.meeting, styles.headerCell]), cell('תאריך', [styles.date, styles.headerCell]), cell('יום', [styles.day, styles.headerCell]), cell('שעות', [styles.hours, styles.headerCell]), cell('היערכות', [styles.preparation, styles.headerCell]));
const meetingRow = (meeting) => h(View, { key: meeting.meeting_number, style: styles.row, wrap: false }, cell(meeting.meeting_number, styles.meeting), cell(meeting.date, [styles.date, { direction: 'ltr', textAlign: 'center' }]), cell(meeting.day, styles.day), cell(meeting.hours, [styles.hours, { direction: 'ltr', textAlign: 'center' }]), cell(meeting.school_preparation, styles.preparation));

function activityPages(snapshot, programIndex, totalPrograms, logo) {
  const meetings = snapshot.program.meetings || [];
  const hasLongPreparation = meetings.some((row) => row.school_preparation.length > 100);
  const firstSize = hasLongPreparation ? 8 : 13;
  const continuationSize = hasLongPreparation ? 10 : 16;
  const chunks = [];
  for (let offset = 0; offset < meetings.length;) {
    const size = chunks.length ? continuationSize : firstSize;
    chunks.push(meetings.slice(offset, offset + size));
    offset += size;
  }
  return chunks.map((chunk, chunkIndex) => {
    const firstDocumentPage = programIndex === 0 && chunkIndex === 0;
    const lastActivityPage = chunkIndex === chunks.length - 1;
    return h(Page, { key: `${snapshot.program.activity_no}-${chunkIndex}`, size: 'A4', style: styles.page },
      firstDocumentPage ? h(Image, { src: logo, style: styles.logo }) : null,
      firstDocumentPage ? h(React.Fragment, null,
        h(Text, { style: styles.honor }, 'לכבוד'),
        h(Text, { style: styles.plain }, snapshot.contact.name || ''),
        snapshot.contact.role ? h(Text, { style: styles.plain }, snapshot.contact.role) : null,
        snapshot.contact.phone ? h(Text, { style: [styles.plain, { direction: 'ltr' }] }, snapshot.contact.phone) : null,
        h(Text, { style: styles.title }, totalPrograms === 1 ? 'להלן סיכום פרטי פעילות' : 'להלן סיכום פרטי פעילויות'),
        line('בית הספר', snapshot.school.name), line('סמל מוסד', snapshot.school.semel_mosad), line('רשות', snapshot.school.authority)) : null,
      h(Text, { style: styles.programTitle }, `${snapshot.program.name}${chunkIndex ? ' — המשך' : ''}`),
      !chunkIndex ? h(React.Fragment, null, line('מספר גפ״ן', snapshot.program.gefen_number || snapshot.program.activity_no), line('מספר מפגשים', snapshot.program.sessions)) : null,
      !chunkIndex ? h(React.Fragment, null,
        h(Text, { style: styles.sectionTitle }, 'להלן מועדי הפעילות כפי שנקבעו ותואמו:'),
        line('מדריך/ה', `${snapshot.instructor.name}${snapshot.instructor.phone ? ` – ${snapshot.instructor.phone}` : ''}`),
        line('כיתה / קבוצה', snapshot.program.meetings?.[0]?.grade_class)) : null,
      h(View, { style: styles.table }, header(), ...chunk.map(meetingRow)),
      lastActivityPage ? h(React.Fragment, null,
        h(Text, { style: [styles.plain, { marginTop: 8 }] }, `מנהל/ת הפעילות מטעם תעשיידע: ${snapshot.activity_manager.name}${snapshot.activity_manager.phone ? ` – ${snapshot.activity_manager.phone}` : ''}`),
        h(Text, { style: styles.sectionTitle }, 'דגשים לפעילות'),
        h(View, { style: styles.highlights }, ...highlights.map((value, index) => h(View, { key: value, style: styles.highlight, wrap: false }, h(Text, { style: styles.highlightNumber }, `${index + 1}.`), h(Text, { style: styles.highlightText }, value))))
      ) : null,
      h(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` })
    );
  });
}

export function ActivityCoordinationDocument({ snapshots, logo }) {
  return h(Document, { title: snapshots.length === 1 ? 'סיכום תיאום פעילות' : 'סיכום תיאום פעילויות', author: 'תעשיידע' }, ...snapshots.flatMap((snapshot, index) => activityPages(snapshot, index, snapshots.length, logo)));
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
