import { FieldValue } from 'firebase-admin/firestore';
import { db, COLLECTIONS, getAll, commitOps, docRef } from './db.js';
import { hashPassword, looksHashed } from './auth.js';
import { cleanDate } from '../shifts-client/src/shared/rules.js';

/**
 * מיגרציה חד-פעמית שמסדרת את הנתונים הקיימים:
 *  1. מצפינה סיסמאות שנשמרו כטקסט גלוי (password → password_hash)
 *  2. ממזגת את User_Exemptions לתוך Users.exemptionIds ומוחקת את הטבלה הישנה
 *  3. מאחדת טיפוסים: organization_id / user_id / shift_type_id כמספרים, תאריכים כ-YYYY-MM-DD
 *  4. מוסיפה organization_id להחלפות (Shift_Exemptions) ומוחקת החלפות יתומות
 * רצה פעם אחת בלבד (נשמר סימון ב-_meta/migration_v1), גם אם יש כמה שרתים.
 */
const MIGRATION_ID = 'migration_v1';

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function changed(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function migrateV1() {
  const ops = [];
  const set = (col, d, data) => ops.push({ type: 'set', ref: docRef(col, d._docId), data, options: { merge: true } });

  // --- משתמשים ופטורים ---
  const [users, userExemptions] = await Promise.all([getAll(COLLECTIONS.USERS), getAll(COLLECTIONS.USER_EXEMPTIONS)]);
  const exByUser = new Map();
  userExemptions.forEach(ue => {
    const uid = num(ue.user_id);
    if (uid === null) return;
    if (!exByUser.has(uid)) exByUser.set(uid, new Set());
    exByUser.get(uid).add(Number(ue.exemption_type_id));
  });

  let hashed = 0;
  for (const u of users) {
    const uid = num(u.id);
    const update = {};
    if (uid !== null && u.id !== uid) update.id = uid;
    const orgId = num(u.organization_id);
    if (u.organization_id !== orgId) update.organization_id = orgId;

    const merged = new Set([...(Array.isArray(u.exemptionIds) ? u.exemptionIds.map(Number) : []), ...(exByUser.get(uid) || [])]);
    const mergedArr = [...merged].filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
    if (changed(mergedArr, u.exemptionIds || [])) update.exemptionIds = mergedArr;

    if (u.full_name && u.full_name !== String(u.full_name).trim()) update.full_name = String(u.full_name).trim();
    if (u.release_date && cleanDate(u.release_date) !== u.release_date) update.release_date = cleanDate(u.release_date) || null;

    if (u.password !== undefined && u.password !== null) {
      if (!u.password_hash) {
        update.password_hash = looksHashed(u.password) ? u.password : await hashPassword(String(u.password).trim());
        hashed++;
      }
      update.password = FieldValue.delete();
    }
    if (Object.keys(update).length) set(COLLECTIONS.USERS, u, update);
  }
  userExemptions.forEach(ue => ops.push({ type: 'delete', ref: docRef(COLLECTIONS.USER_EXEMPTIONS, ue._docId) }));

  // --- תורנויות ---
  const shifts = await getAll(COLLECTIONS.SHIFTS);
  const shiftById = new Map();
  shifts.forEach(s => {
    shiftById.set(num(s.id), s);
    const update = {};
    const fix = (field, value) => { if (changed(s[field], value)) update[field] = value; };
    fix('id', num(s.id));
    fix('organization_id', num(s.organization_id));
    fix('user_id', num(s.user_id) || null);
    fix('shift_type_id', num(s.shift_type_id));
    fix('start_date', cleanDate(s.start_date));
    fix('end_date', cleanDate(s.end_date));
    fix('is_published', Number(s.is_published) === 1 ? 1 : 0);
    if (Object.keys(update).length) set(COLLECTIONS.SHIFTS, s, update);
  });

  // --- החלפות ---
  const replacements = await getAll(COLLECTIONS.REPLACEMENTS);
  replacements.forEach(r => {
    const shift = shiftById.get(num(r.shift_id));
    if (!shift) {
      ops.push({ type: 'delete', ref: docRef(COLLECTIONS.REPLACEMENTS, r._docId) });
      return;
    }
    const update = {};
    if (changed(r.shift_id, num(r.shift_id))) update.shift_id = num(r.shift_id);
    if (changed(r.organization_id, num(shift.organization_id))) update.organization_id = num(shift.organization_id);
    if (changed(r.start_date, cleanDate(r.start_date))) update.start_date = cleanDate(r.start_date);
    if (changed(r.end_date, cleanDate(r.end_date))) update.end_date = cleanDate(r.end_date);
    if (Object.keys(update).length) set(COLLECTIONS.REPLACEMENTS, r, update);
  });

  // --- אילוצים, סוגי תורנות, תקופות ---
  for (const col of [COLLECTIONS.CONSTRAINTS, COLLECTIONS.SHIFT_TYPES, COLLECTIONS.PERIODS]) {
    const docs = await getAll(col);
    docs.forEach(d => {
      const update = {};
      if (d.organization_id !== undefined && d.organization_id !== null && changed(d.organization_id, num(d.organization_id))) {
        update.organization_id = num(d.organization_id);
      }
      if (col === COLLECTIONS.CONSTRAINTS && changed(d.user_id ?? null, num(d.user_id) || null)) update.user_id = num(d.user_id) || null;
      if (d.start_date !== undefined && changed(d.start_date, cleanDate(d.start_date))) update.start_date = cleanDate(d.start_date);
      if (d.end_date !== undefined && changed(d.end_date, cleanDate(d.end_date))) update.end_date = cleanDate(d.end_date);
      if (Object.keys(update).length) set(col, d, update);
    });
  }

  const written = await commitOps(ops);
  console.log(`🛠️  מיגרציה הושלמה: ${written} פעולות, ${hashed} סיסמאות הוצפנו`);
}

export async function runMigrations() {
  const ref = db.collection('_meta').doc(MIGRATION_ID);
  try {
    await ref.create({ status: 'running', started_at: new Date().toISOString() });
  } catch {
    // מסמך קיים: המיגרציה כבר רצה או רצה כרגע בשרת אחר
    for (let i = 0; i < 60; i++) {
      const snap = await ref.get();
      if (snap.get('status') === 'done') return;
      if (snap.get('status') === 'failed') break; // ננסה שוב
      await new Promise(r => setTimeout(r, 2000));
    }
    await ref.set({ status: 'running', started_at: new Date().toISOString() });
  }
  try {
    await migrateV1();
    await ref.set({ status: 'done', finished_at: new Date().toISOString() }, { merge: true });
  } catch (err) {
    await ref.set({ status: 'failed', error: err.message }, { merge: true });
    throw err;
  }
}
