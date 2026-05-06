/**
 * migrate-users-to-auth.mjs
 * מיגרציה חד-פעמית: יצירת משתמשי Supabase Auth מתוך public.users
 *
 * הרצה:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-users-to-auth.mjs
 *
 * TODO (שלב הבא — לאחר אימות המיגרציה):
 *   יש לאפס / למחוק את entry_code לכל משתמש שעבר מיגרציה,
 *   או לחסום את הגישה לעמודה זו מהלקוח (RLS / הסרת העמודה מ-SELECT).
 *   entry_code חשוף כרגע ב-public.users — אין להשאיר אותו חשוף לאחר מעבר ל-Auth.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[migrate] חסרים משתנני סביבה: SUPABASE_URL ו/או SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  console.log('[migrate] קורא משתמשים פעילים מ-public.users...');

  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('user_id, entry_code, name, full_name, role, auth_email, is_active, auth_user_id, migrated_to_auth')
    .eq('is_active', true);

  if (fetchError) {
    console.error('[migrate] שגיאה בקריאת המשתמשים:', fetchError.message);
    process.exit(1);
  }

  console.log(`[migrate] נמצאו ${users.length} משתמשים פעילים.`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const userId = String(user.user_id || '').trim();

    if (!userId) {
      console.warn('[migrate] משתמש ללא user_id — מדולג.');
      skipped++;
      continue;
    }

    if (user.migrated_to_auth === true || String(user.migrated_to_auth).toLowerCase() === 'true') {
      console.log(`[migrate] [דילוג] ${userId} — migrated_to_auth=true`);
      skipped++;
      continue;
    }

    if (user.auth_user_id && String(user.auth_user_id).trim()) {
      console.log(`[migrate] [דילוג] ${userId} — auth_user_id כבר קיים (${user.auth_user_id})`);
      skipped++;
      continue;
    }

    const email = String(user.auth_email || '').trim() || `${userId}@taasiyeda.local`;
    const password = String(user.entry_code || '').trim();

    if (!password) {
      console.warn(`[migrate] [כישלון] ${userId} — entry_code ריק, לא ניתן ליצור סיסמה.`);
      failed++;
      continue;
    }

    const fullName = String(user.full_name || user.name || '').trim();
    const role = String(user.role || '').trim();

    const { data: authData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        employee_id: userId,
        full_name: fullName,
        role
      }
    });

    if (createError) {
      console.error(`[migrate] [כישלון] ${userId} (${email}): ${createError.message}`);
      failed++;
      continue;
    }

    const newAuthId = authData?.user?.id;
    if (!newAuthId) {
      console.error(`[migrate] [כישלון] ${userId} — יצירה הצליחה אך לא הוחזר auth user id.`);
      failed++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        auth_user_id: newAuthId,
        auth_email: email,
        migrated_to_auth: true
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`[migrate] [אזהרה] ${userId} — נוצר ב-Auth (${newAuthId}) אך עדכון public.users נכשל: ${updateError.message}`);
      failed++;
      continue;
    }

    console.log(`[migrate] [נוצר] ${userId} → auth_user_id=${newAuthId}, email=${email}`);
    created++;
  }

  console.log('\n========== סיכום מיגרציה ==========');
  console.log(`  ✓ נוצרו:   ${created}`);
  console.log(`  ⟳ דולגו:   ${skipped}`);
  console.log(`  ✗ נכשלו:   ${failed}`);
  console.log('====================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate] שגיאה לא צפויה:', err);
  process.exit(1);
});
