import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateId, commitOps, docRef, getById, getByOrg, stripInternal } from '../db.js';
import { requireAuth, requireAdmin, resolveOrgId, assertSameOrg, isAdmin } from '../auth.js';
import { loadOrgContext, getShiftTypesForOrg, getReplacementsForShift, getExemptionTypes } from '../services.js';
import { queueCalendarSync } from '../calendar.js';
import {
  addDays, checkEligibility, cleanDate, computeShiftPoints, getPeriodName, hasNearbyShift,
  isGuardType, isInRotation, potentialOf, rangeContainsShabbat, todayInIsrael, daysInclusive
} from '../../shifts-client/src/shared/rules.js';

const router = Router();

const flag = v => (v === true || Number(v) === 1 || v === '1') ? 1 : 0;

function explicitFlag(v) {
  if (v === undefined || v === null || v === '') return null;
  return flag(v);
}

/**
 * בודק ומנרמל נתוני תורנות (גם ליצירה וגם לעדכון).
 * existing — התורנות הקיימת בעדכון; שדות שלא נשלחו נשארים כמו שהם.
 */
async function buildShiftData(orgId, body, existing = null) {
  const pick = (field, fallback) => (body[field] !== undefined ? body[field] : (existing ? existing[field] : fallback));

  const startDate = cleanDate(pick('start_date', ''));
  const endDate = cleanDate(pick('end_date', ''));
  if (!startDate || !endDate) throw new HttpError(400, 'חובה למלא תאריך התחלה וסיום');
  if (endDate < startDate) throw new HttpError(400, 'תאריך הסיום לא יכול להיות לפני תאריך ההתחלה');
  if (daysInclusive(startDate, endDate) > 62) throw new HttpError(400, 'תורנות לא יכולה להיות ארוכה מחודשיים');

  const types = await getShiftTypesForOrg(orgId);
  const shiftTypeId = Number(pick('shift_type_id', null));
  const shiftType = types.find(t => Number(t.id) === shiftTypeId);
  if (!shiftType) throw new HttpError(400, 'יש לבחור סוג תורנות תקין');

  const rawUser = pick('user_id', null);
  const userId = rawUser === '' || rawUser === null || rawUser === undefined || Number(rawUser) === 0 ? null : Number(rawUser);

  // שבת: אם המנהל סימן/ביטל במפורש — מכבדים, אחרת מזהים לפי התאריכים
  const explicitWeekend = explicitFlag(body.is_weekend);
  const isWeekend = explicitWeekend !== null ? explicitWeekend : (rangeContainsShabbat(startDate, endDate) ? 1 : 0);

  const data = {
    organization_id: orgId,
    user_id: userId,
    shift_type_id: shiftTypeId,
    start_date: startDate,
    end_date: endDate,
    is_weekend: isWeekend,
    is_baltam: flag(pick('is_baltam', 0)),
    notes: String(pick('notes', '') || '').slice(0, 1000),
    holiday_name: pick('holiday_name', null) || null
  };
  if (body.group_id) data.group_id = String(body.group_id);

  if (userId !== null) {
    const ctx = await loadOrgContext(orgId, ['users', 'exemptionTypes', 'constraints']);
    const user = ctx.users.find(u => Number(u.id) === userId);
    if (!user) throw new HttpError(400, 'החייל לא נמצא בטייסת');
    if (Number(user.is_active) !== 1) throw new HttpError(400, 'החייל אינו פעיל');
    const check = checkEligibility({
      user, startDate, endDate, shiftType,
      exemptionTypes: ctx.exemptionTypes, constraints: ctx.constraints
    });
    if (!check.ok) throw new HttpError(400, check.reason);
  }
  return { data, shiftType };
}

// ---------------------------------------------------------------------------
// סוגי תורנות ופטורים
// ---------------------------------------------------------------------------

router.get('/shift-types', requireAuth, async (req, res) => {
  const types = await getShiftTypesForOrg(resolveOrgId(req));
  res.json(types.map(stripInternal));
});

router.post('/shift-types', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'חובה להזין שם תורנות');
  const points = Number(req.body.points_base);
  const id = await allocateId(COLLECTIONS.SHIFT_TYPES);
  const type = {
    id,
    organization_id: orgId,
    name,
    is_weekend: flag(req.body.is_weekend),
    color: /^#?[0-9a-fA-F]{6}$/.test(req.body.color || '') ? (req.body.color.startsWith('#') ? req.body.color : `#${req.body.color}`) : '#3174ad',
    points_base: Number.isFinite(points) && points > 0 ? points : 1,
    gender_limit: ['male', 'female'].includes(req.body.gender_limit) ? req.body.gender_limit : 'all'
  };
  await docRef(COLLECTIONS.SHIFT_TYPES, id).set(type);
  res.status(201).json({ id, message: 'סוג תורנות נוצר!' });
});

router.get('/exemption-types', requireAuth, async (req, res) => {
  res.json((await getExemptionTypes()).map(stripInternal));
});

// ---------------------------------------------------------------------------
// תורנויות
// ---------------------------------------------------------------------------

router.get('/shifts', requireAuth, async (req, res) => {
  const orgId = resolveOrgId(req);
  const { shifts, users, types } = await loadOrgContext(orgId, ['shifts', 'users', 'types']);
  const visible = isAdmin(req.user) ? shifts : shifts.filter(s => Number(s.is_published) === 1);
  res.json(visible.map(s => {
    const u = s.user_id ? users.find(x => Number(x.id) === Number(s.user_id)) : null;
    const t = types.find(x => Number(x.id) === Number(s.shift_type_id));
    return {
      ...stripInternal(s),
      full_name: u ? u.full_name : (s.former_user_name ? `${s.former_user_name} (לשעבר)` : null),
      type_name: t ? t.name : 'תורנות',
      type_color: t ? t.color : '#3174ad',
      is_published: Number(s.is_published) === 1 ? 1 : 0
    };
  }));
});

router.post('/shifts', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const { data } = await buildShiftData(orgId, req.body);
  const id = await allocateId(COLLECTIONS.SHIFTS);
  const shift = {
    ...data,
    id,
    is_published: 0,
    group_id: data.group_id || `grp_${Date.now()}_${id}`,
    created_at: new Date().toISOString()
  };
  await docRef(COLLECTIONS.SHIFTS, id).set(shift);
  res.status(201).json({ id, group_id: shift.group_id, message: 'התורנות נשמרה!' });
});

// פרסום וביטול פרסום משתמשים באותו כלל: תורנות שמתחילה בתוך הטווח
async function setPublished(req, value) {
  const orgId = resolveOrgId(req);
  const start = cleanDate(req.body.start_date);
  const end = cleanDate(req.body.end_date);
  if (!start || !end || end < start) throw new HttpError(400, 'טווח התאריכים אינו תקין');
  const shifts = await getByOrg(COLLECTIONS.SHIFTS, orgId);
  const affected = shifts.filter(s => s.start_date >= start && s.start_date <= end && Number(s.is_published) !== value);
  await commitOps(affected.map(s => ({ type: 'update', ref: docRef(COLLECTIONS.SHIFTS, s._docId), data: { is_published: value } })));
  queueCalendarSync(affected.map(s => s.user_id));
  return affected.length;
}

router.put('/shifts/publish-range', requireAuth, requireAdmin, async (req, res) => {
  const count = await setPublished(req, 1);
  res.json({ message: `הצלחה! פורסמו ${count} תורנויות.`, count });
});

router.put('/shifts/unpublish-range', requireAuth, requireAdmin, async (req, res) => {
  const count = await setPublished(req, 0);
  res.json({ message: `בוטל הפרסום ל-${count} תורנויות.`, count });
});

router.put('/shifts/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const existing = await getById(COLLECTIONS.SHIFTS, req.params.id);
  assertSameOrg(existing, orgId, 'התורנות');
  const { data } = await buildShiftData(orgId, req.body, existing);
  await docRef(COLLECTIONS.SHIFTS, existing._docId).update(data);
  if (Number(existing.is_published) === 1) queueCalendarSync([existing.user_id, data.user_id]);
  res.json({ message: 'התורנות עודכנה!' });
});

// פיצול תורנות לשני חלקים בפעולה אטומית אחת.
// תורנות רגילה: החלק הראשון מסתיים יום לפני תאריך הפיצול.
// שמירות: ההחלפה ב-14:00 ביום הפיצול, לכן יום הפיצול שייך לשני החלקים (חצי נקודה לכל אחד).
router.post('/shifts/:id/split', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const shift = await getById(COLLECTIONS.SHIFTS, req.params.id);
  assertSameOrg(shift, orgId, 'התורנות');
  const splitDate = cleanDate(req.body.split_date);
  if (!splitDate) throw new HttpError(400, 'נא לבחור תאריך לפיצול');

  const types = await getShiftTypesForOrg(orgId);
  const guard = isGuardType(types.find(t => Number(t.id) === Number(shift.shift_type_id)));
  const firstEnd = guard ? splitDate : addDays(splitDate, -1);
  if (firstEnd < shift.start_date || splitDate > shift.end_date || (!guard && splitDate <= shift.start_date)) {
    throw new HttpError(400, 'תאריך הפיצול חייב להיות בתוך טווח התורנות');
  }

  const groupId = shift.group_id || `grp_split_${Date.now()}_${shift.id}`;
  const newId = await allocateId(COLLECTIONS.SHIFTS);
  const replacements = await getReplacementsForShift(shift.id);

  const ops = [
    {
      type: 'update', ref: docRef(COLLECTIONS.SHIFTS, shift._docId),
      data: { end_date: firstEnd, is_weekend: rangeContainsShabbat(shift.start_date, firstEnd) ? 1 : 0, group_id: groupId }
    },
    {
      type: 'set', ref: docRef(COLLECTIONS.SHIFTS, newId),
      data: {
        id: newId, organization_id: orgId, user_id: null, shift_type_id: shift.shift_type_id,
        start_date: splitDate, end_date: shift.end_date,
        is_weekend: rangeContainsShabbat(splitDate, shift.end_date) ? 1 : 0,
        is_baltam: Number(shift.is_baltam) === 1 ? 1 : 0, is_published: 0,
        notes: shift.notes || '', holiday_name: shift.holiday_name || null,
        group_id: groupId, created_at: new Date().toISOString()
      }
    }
  ];
  // החלפות שנופלות בחלק השני עוברות איתו; החלפות שחוצות את נקודת הפיצול נחתכות
  for (const r of replacements) {
    if (r.start_date >= splitDate) {
      ops.push({ type: 'update', ref: docRef(COLLECTIONS.REPLACEMENTS, r._docId), data: { shift_id: newId } });
    } else if (r.end_date > firstEnd) {
      ops.push({ type: 'update', ref: docRef(COLLECTIONS.REPLACEMENTS, r._docId), data: { end_date: firstEnd } });
    }
  }
  await commitOps(ops);
  if (Number(shift.is_published) === 1) queueCalendarSync([shift.user_id]);
  res.status(201).json({ message: 'התורנות פוצלה בהצלחה! ✂️', new_shift_id: newId });
});

router.delete('/shifts/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const shift = await getById(COLLECTIONS.SHIFTS, req.params.id);
  assertSameOrg(shift, orgId, 'התורנות');
  const replacements = await getReplacementsForShift(shift.id);
  await commitOps([
    ...replacements.map(r => ({ type: 'delete', ref: docRef(COLLECTIONS.REPLACEMENTS, r._docId) })),
    { type: 'delete', ref: docRef(COLLECTIONS.SHIFTS, shift._docId) }
  ]);
  if (Number(shift.is_published) === 1) queueCalendarSync([shift.user_id]);
  res.json({ message: 'התורנות וההחלפות שלה נמחקו!' });
});

// ---------------------------------------------------------------------------
// שיבוץ אוטומטי
// ---------------------------------------------------------------------------

router.post('/auto-assign', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const ctx = await loadOrgContext(orgId);
  const today = todayInIsrael();
  const typeOf = s => ctx.types.find(t => Number(t.id) === Number(s.shift_type_id));
  const periodOf = s => getPeriodName(s.start_date, ctx.periods);

  // רק תורנויות עתידיות שעדיין לא שובצו
  const open = ctx.shifts
    .filter(s => !s.user_id && s.start_date >= today)
    .sort((a, b) => daysInclusive(b.start_date, b.end_date) - daysInclusive(a.start_date, a.end_date) || a.start_date.localeCompare(b.start_date));

  // חיילים בסבב עם פוטנציאל גדול מ-0
  const rotation = ctx.users.filter(u => isInRotation(u) && potentialOf(u) > 0);

  // עומס לכל חייל לפי תקופה, בנקודות (לא בימים) — כך חייל ותיק לא "נפטר" לנצח
  const load = new Map(); // key: `${userId}|${period}`
  const keyOf = (uid, period) => `${uid}|${period}`;
  ctx.shifts.forEach(s => {
    if (!s.user_id) return;
    const k = keyOf(Number(s.user_id), periodOf(s));
    load.set(k, (load.get(k) || 0) + computeShiftPoints(s, typeOf(s), ctx.replacements));
  });

  const ops = [];
  const assignedUsers = new Set();
  let assigned = 0;
  const unfilled = [];

  for (const shift of open) {
    const type = typeOf(shift);
    const period = periodOf(shift);
    const candidates = rotation.filter(user =>
      checkEligibility({
        user, startDate: shift.start_date, endDate: shift.end_date, shiftType: type,
        exemptionTypes: ctx.exemptionTypes, constraints: ctx.constraints
      }).ok &&
      !hasNearbyShift({ userId: user.id, startDate: shift.start_date, endDate: shift.end_date, shifts: ctx.shifts })
    );
    if (!candidates.length) {
      unfilled.push(shift.id);
      continue;
    }
    const score = u => (load.get(keyOf(Number(u.id), period)) || 0) / (potentialOf(u) / 100);
    candidates.sort((a, b) => score(a) - score(b) || Number(a.id) - Number(b.id));
    const best = candidates[0];

    shift.user_id = Number(best.id); // מעדכן את הרשימה כדי שבדיקת המרווח תכיר את השיבוץ החדש
    const k = keyOf(Number(best.id), period);
    load.set(k, (load.get(k) || 0) + computeShiftPoints(shift, type, ctx.replacements));
    ops.push({ type: 'update', ref: docRef(COLLECTIONS.SHIFTS, shift._docId), data: { user_id: Number(best.id) } });
    if (Number(shift.is_published) === 1) assignedUsers.add(Number(best.id));
    assigned++;
  }

  await commitOps(ops);
  queueCalendarSync([...assignedUsers]);
  res.json({
    success: true,
    assigned,
    unfilled: unfilled.length,
    message: unfilled.length
      ? `שובצו ${assigned} תורנויות. ל-${unfilled.length} תורנויות לא נמצא חייל מתאים.`
      : `השיבוץ הושלם! שובצו ${assigned} תורנויות.`
  });
});

export default router;
