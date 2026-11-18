import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateId, commitOps, docRef, getById, getByOrg, getWhere, limitedUser, publicUser } from '../db.js';
import { requireAuth, requireAdmin, resolveOrgId, assertSameOrg, hashPassword, validatePassword, isAdmin } from '../auth.js';
import { isNameTaken, getExemptionTypes } from '../services.js';
import { cleanDate, todayInIsrael } from '../../shifts-client/src/shared/rules.js';

const router = Router();

function parseFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return (value === true || Number(value) === 1 || value === '1') ? 1 : 0;
}

function parsePotential(value, fallback = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

async function cleanExemptionIds(raw) {
  if (!Array.isArray(raw)) return [];
  const valid = new Set((await getExemptionTypes()).map(t => Number(t.id)));
  return [...new Set(raw.map(Number))].filter(id => valid.has(id)).sort((a, b) => a - b);
}

router.get('/users', requireAuth, async (req, res) => {
  const orgId = resolveOrgId(req);
  const users = await getByOrg(COLLECTIONS.USERS, orgId);
  // חייל רגיל רואה רק שם ונתוני סבב של חבריו — בלי פטורים, תאריכי שחרור וכו'
  res.json(isAdmin(req.user)
    ? users.map(publicUser)
    : users.map(u => (Number(u.id) === Number(req.user.id) ? publicUser(u) : limitedUser(u))));
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const fullName = String(req.body.full_name || '').trim();
  if (!fullName) throw new HttpError(400, 'חובה למלא שם');
  const password = validatePassword(req.body.password);
  if (await isNameTaken(fullName)) throw new HttpError(409, 'כבר קיים משתמש עם השם הזה — הוסיפו שם משפחה או מספר');

  const role = req.body.role === 'admin' && req.user.role === 'super_admin' ? 'admin' : 'soldier';
  const userId = await allocateId(COLLECTIONS.USERS);
  const user = {
    id: userId,
    organization_id: orgId,
    full_name: fullName,
    password_hash: await hashPassword(password),
    role,
    does_shifts: parseFlag(req.body.does_shifts, 1),
    is_active: parseFlag(req.body.is_active, 1),
    release_date: cleanDate(req.body.release_date) || null,
    potential_reduction: parsePotential(req.body.potential_reduction),
    division: String(req.body.division || '').trim() || 'לא מוגדר',
    gender: req.body.gender === 'female' ? 'female' : 'male',
    exemptionIds: await cleanExemptionIds(req.body.exemptionIds),
    joined_date: todayInIsrael()
  };
  await docRef(COLLECTIONS.USERS, userId).set(user);
  res.status(201).json({ id: userId, user: publicUser(user), message: 'החייל נוצר בהצלחה!' });
});

// עדכון חלקי: רק שדות שנשלחו משתנים (שדה שלא נשלח לא נמחק)
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const target = await getById(COLLECTIONS.USERS, req.params.id);
  assertSameOrg(target, orgId, 'החייל');
  const b = req.body || {};
  const update = {};

  if (b.full_name !== undefined) {
    const name = String(b.full_name).trim();
    if (!name) throw new HttpError(400, 'השם לא יכול להיות ריק');
    if (name !== target.full_name && await isNameTaken(name, target.id)) throw new HttpError(409, 'כבר קיים משתמש עם השם הזה');
    update.full_name = name;
  }
  if (b.password !== undefined && String(b.password).trim() !== '') {
    update.password_hash = await hashPassword(validatePassword(b.password));
  }
  if (b.release_date !== undefined) update.release_date = cleanDate(b.release_date) || null;
  if (b.potential_reduction !== undefined) update.potential_reduction = parsePotential(b.potential_reduction, target.potential_reduction ?? 100);
  if (b.does_shifts !== undefined) update.does_shifts = parseFlag(b.does_shifts, target.does_shifts);
  if (b.is_active !== undefined) update.is_active = parseFlag(b.is_active, target.is_active);
  if (b.division !== undefined) update.division = String(b.division || '').trim() || 'לא מוגדר';
  if (b.gender !== undefined) update.gender = b.gender === 'female' ? 'female' : 'male';
  if (Array.isArray(b.exemptionIds)) update.exemptionIds = await cleanExemptionIds(b.exemptionIds);

  if (Object.keys(update).length) await docRef(COLLECTIONS.USERS, target._docId).update(update);
  res.json({ message: 'החייל עודכן בהצלחה!', user: publicUser({ ...target, ...update }) });
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const target = await getById(COLLECTIONS.USERS, req.params.id);
  if (!target) throw new HttpError(404, 'החייל לא נמצא');
  if (req.user.role !== 'super_admin') assertSameOrg(target, req.user.organization_id, 'החייל');
  if (Number(target.id) === Number(req.user.id)) throw new HttpError(400, 'אי אפשר למחוק את המשתמש שלך');
  if (target.role === 'super_admin') throw new HttpError(403, 'אי אפשר למחוק מנהל-על');

  const today = todayInIsrael();
  const [shifts, constraints] = await Promise.all([
    getWhere(COLLECTIONS.SHIFTS, 'user_id', Number(target.id)),
    getWhere(COLLECTIONS.CONSTRAINTS, 'user_id', Number(target.id))
  ]);

  const ops = [];
  shifts.forEach(s => {
    const ref = docRef(COLLECTIONS.SHIFTS, s._docId);
    if (s.start_date >= today) {
      // תורנות עתידית חוזרת ל"דרוש שיבוץ"
      ops.push({ type: 'update', ref, data: { user_id: null } });
    } else {
      // היסטוריה נשמרת: שומרים את השם כדי שהלוח והסטטיסטיקה לא יציגו "null"
      ops.push({ type: 'update', ref, data: { former_user_name: target.full_name } });
    }
  });
  constraints.forEach(c => ops.push({ type: 'delete', ref: docRef(COLLECTIONS.CONSTRAINTS, c._docId) }));
  ops.push({ type: 'delete', ref: docRef(COLLECTIONS.USERS, target._docId) });
  await commitOps(ops);

  const freed = shifts.filter(s => s.start_date >= today).length;
  res.json({ message: `החייל נמחק. ${freed} תורנויות עתידיות חזרו לשיבוץ.` });
});

export default router;
