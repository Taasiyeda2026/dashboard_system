import React from 'react';
import { Font, renderToFile } from '@react-pdf/renderer';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActivityDocumentSnapshot } from '../frontend/src/activity-coordination/domain.js';
import { ActivityCoordinationDocument } from '../frontend/src/activity-coordination/pdf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'artifacts/activity-coordination-pdf-poc');
const h = React.createElement;
for (const [name, fontWeight] of [['Arimo-Regular.ttf', 400], ['Arimo-Medium.ttf', 500], ['Arimo-SemiBold.ttf', 600], ['Arimo-Bold.ttf', 700]]) {
  Font.register({ family: 'Arimo', src: path.join(root, 'frontend/assets/fonts', name), fontWeight });
}

function sampleActivity(id, programName, programNumber, sessions, startDay = 3) {
  const row = {
    row_id: `poc-${id}`, school: 'בית הספר הרב-תחומי ע״ש יצחק רבין', semel_mosad: '540001', authority: 'עיריית תל אביב-יפו',
    contact_name: 'יעל כהן', contact_role: 'רכזת חדשנות (STEM)', contact_phone: '050-1234567',
    activity_name: programName, activity_no: programNumber, gefen_number: `GFN-${77000 + id}`,
    sessions: String(sessions), start_time: '08:30:00', end_time: '10:00:00', grade: 'כיתה ח׳',
    class_group: `קבוצה ${id}`, emp_id: 9876, instructor_name: 'נועה לוי', activity_manager: 'הילה רוזן'
  };
  for (let meeting = 1; meeting <= sessions; meeting += 1) {
    const date = new Date(Date.UTC(2026, 8, startDay + ((meeting - 1) * 7)));
    row[`date_${meeting}`] = date.toISOString().slice(0, 10);
  }
  return row;
}

function syllabus(programNumber, sessions, long = false) {
  return Array.from({ length: sessions }, (_, index) => ({
    program_number: programNumber,
    meeting_order: index + 1,
    school_preparation: index % 4 === 0 ? '' : long
      ? `יש להכין מראש מחשב לכל זוג תלמידים, חיבור יציב לאינטרנט, מקרן תקין ולוודא שניתן להפעיל קובצי English Lab (גרסה ${index + 1}) ללא הרשאות מנהל. במקרה של תקלה יש לעדכן את המדריכה לפחות יום לפני המפגש.`
      : index === 1 ? 'מחשבים עם חיבור לאינטרנט ומקרן תקין' : 'מחברות וכלי כתיבה'
  }));
}

const snapshot = (activity, syllabusRows) => buildActivityDocumentSnapshot({
  activity, syllabusRows, instructor: { mobile: '052-1112233' }, activityManager: { phone: '052-3222951' }
});

async function writeBase64(pdfPath) {
  const bytes = await readFile(pdfPath);
  await writeFile(`${pdfPath}.b64.txt`, bytes.toString('base64'));
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const logo = path.join(root, 'frontend/assets/invitations/logos/taasiyeda-logo.png');
const single = sampleActivity(1, 'יזמות באנגלית English Lab', 'P-100', 10);
const multi = [
  ['מדע וטכנולוגיה – מסלול Alpha', 'P-201', 14, 3],
  ['יזמות וחדשנות English & Hebrew', 'P-202', 13, 4],
  ['רובוטיקה, תכנון ובנייה (מתקדמים)', 'P-203', 15, 5]
].map(([name, number, sessions, day], index) => snapshot(sampleActivity(index + 2, name, number, sessions, day), syllabus(number, sessions, true)));
const singlePath = path.join(outputDir, 'coordination-single-10-meetings.pdf');
const multiPath = path.join(outputDir, 'coordination-school-3-activities.pdf');
await renderToFile(h(ActivityCoordinationDocument, { snapshots: [snapshot(single, syllabus('P-100', 10))], logo }), singlePath);
await renderToFile(h(ActivityCoordinationDocument, { snapshots: multi, logo }), multiPath);
await Promise.all([writeBase64(singlePath), writeBase64(multiPath)]);
console.log(outputDir);
