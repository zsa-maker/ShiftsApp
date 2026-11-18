import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateId, commitOps, docRef, getAll, getById, getByOrg, publicUser } from '../db.js';
import { requireAuth, requireSuperAdmin, hashPassword, validatePassword } from '../auth.js';
import { isNameTaken } from '../services.js';
import { todayInIsrael } from '../../shifts-client/src/shared/rules.js';

const router = Router();
const guard = [requireAuth, requireSuperAdmin];

router.get('/squadrons-with-admin', guard, async (req, res) => {
  const [orgs, users] = await Promise.all([getAll(COLLECTIONS.ORGS), getAll(COLLECTIONS.USERS)]);
  res.json(orgs.map(o => {
    const admin = users.find(u => Number(u.organization_id) === Number(o.id) && u.role === 'admin');
    return { id: o.id, name: o.name, admin_name: admin?.full_name || null, admin_id: admin?.id ?? null };
  }));
});

router.post('/setup-squadron', guard, async (req, res) => {
  const name = String(req.body?.squadronData?.name || '').trim();
  const adminName = String(req.body?.adminData?.full_name || '').trim();
  if (!name || !adminName) throw new HttpError(400, 'יש למלא שם טייסת ושם אחראי');
  const password = validatePassword(req.body?.adminData?.password);
  if (await isNameTaken(adminName)) throw new HttpError(409, 'כבר קיים משתמש עם השם הזה');

  const [orgId, userId] = await Promise.all([allocateId(COLLECTIONS.ORGS), allocateId(COLLECTIONS.USERS)]);
  const admin = {
    id: userId,
    full_name: adminName,
    password_hash: await hashPassword(password),
    role: 'admin',
    organization_id: orgId,
    is_active: 1,
    does_shifts: 0,
    potential_reduction: 100,
    division: 'לא מוגדר',
    gender: 'male',
    exemptionIds: [],
    joined_date: todayInIsrael()
  };
  await commitOps([
    { type: 'set', ref: docRef(COLLECTIONS.ORGS, orgId), data: { id: orgId, name } },
    { type: 'set', ref: docRef(COLLECTIONS.USERS, userId), data: admin }
  ]);
  res.status(201).json({ squadronId: orgId, admin: publicUser(admin) });
});

router.put('/users/update-admin/:orgId', guard, async (req, res) => {
  const orgId = Number(req.params.orgId);
  const newAdmin = await getById(COLLECTIONS.USERS, req.body?.newAdminId);
  if (!newAdmin || Number(newAdmin.organization_id) !== orgId) {
    throw new HttpError(404, 'החייל לא נמצא בטייסת הזו');
  }
  const users = await getByOrg(COLLECTIONS.USERS, orgId);
  const ops = users
    .filter(u => u.role === 'admin' && Number(u.id) !== Number(newAdmin.id))
    .map(u => ({ type: 'update', ref: docRef(COLLECTIONS.USERS, u._docId), data: { role: 'soldier' } }));
  ops.push({ type: 'update', ref: docRef(COLLECTIONS.USERS, newAdmin._docId), data: { role: 'admin' } });
  await commitOps(ops);
  res.json({ message: 'האחראי עודכן בהצלחה!' });
});

router.delete('/organizations/:id', guard, async (req, res) => {
  const orgId = Number(req.params.id);
  const org = await getById(COLLECTIONS.ORGS, orgId);
  if (!org) throw new HttpError(404, 'הטייסת לא נמצאה');

  const cols = [COLLECTIONS.SHIFTS, COLLECTIONS.REPLACEMENTS, COLLECTIONS.CONSTRAINTS, COLLECTIONS.PERIODS, COLLECTIONS.SHIFT_TYPES, COLLECTIONS.USERS];
  const ops = [];
  for (const col of cols) {
    const docs = await getByOrg(col, orgId);
    docs.forEach(d => ops.push({ type: 'delete', ref: docRef(col, d._docId) }));
  }
  ops.push({ type: 'delete', ref: docRef(COLLECTIONS.ORGS, org._docId) });
  const count = await commitOps(ops);
  res.json({ message: `הטייסת וכל נתוניה נמחקו (${count - 1} רשומות)` });
});

export default router;
