import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateId, commitOps, docRef, getAll, getById, getByOrg, stripInternal } from '../db.js';
import { requireAuth, requireAdmin, requireSuperAdmin, resolveOrgId, assertSameOrg, isAdmin } from '../auth.js';
import { cleanDate } from '../../shifts-client/src/shared/rules.js';

// החלפות (פט / טייסת אחרת) — נשמרות באוסף Shift_Exemptions
const router = Router();
const TYPES = ['pet', 'squadron'];
const timeOrNull = v => (/^\d{2}:\d{2}$/.test(v || '') ? v : null);

async function validated(orgId, body, existing = null) {
  const shiftId = Number(body.shift_id ?? existing?.shift_id);
  const shift = await getById(COLLECTIONS.SHIFTS, shiftId);
  assertSameOrg(shift, orgId, 'התורנות');
  const start = cleanDate(body.start_date ?? existing?.start_date);
  const end = cleanDate(body.end_date ?? existing?.end_date);
  if (!start || !end || end < start) throw new HttpError(400, 'תאריכי ההחלפה אינם תקינים');
  if (start < shift.start_date || end > shift.end_date) throw new HttpError(400, 'ההחלפה חייבת להיות בתוך טווח התורנות');
  const type = body.type ?? existing?.type ?? 'pet';
  if (!TYPES.includes(type)) throw new HttpError(400, 'סוג ההחלפה אינו תקין');
  return {
    shift_id: shiftId,
    organization_id: orgId,
    start_date: start,
    end_date: end,
    type,
    start_time: timeOrNull(body.start_time ?? existing?.start_time),
    end_time: timeOrNull(body.end_time ?? existing?.end_time)
  };
}

router.get('/shift-exemptions', requireAuth, async (req, res) => {
  const orgId = resolveOrgId(req);
  const replacements = await getByOrg(COLLECTIONS.REPLACEMENTS, orgId);
  if (isAdmin(req.user)) return res.json(replacements.map(stripInternal));
  // חייל רואה החלפות רק של תורנויות מפורסמות
  const shifts = await getByOrg(COLLECTIONS.SHIFTS, orgId);
  const published = new Set(shifts.filter(s => Number(s.is_published) === 1).map(s => Number(s.id)));
  res.json(replacements.filter(r => published.has(Number(r.shift_id))).map(stripInternal));
});

router.post('/shift-exemptions', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const data = await validated(orgId, req.body);
  const id = await allocateId(COLLECTIONS.REPLACEMENTS);
  await docRef(COLLECTIONS.REPLACEMENTS, id).set({ id, ...data });
  res.status(201).json({ id });
});

// ניקוי החלפות יתומות (תחזוקה; השרת כבר מוחק החלפות יחד עם התורנות)
router.delete('/shift-exemptions/cleanup', requireAuth, requireSuperAdmin, async (req, res) => {
  const [replacements, shifts] = await Promise.all([getAll(COLLECTIONS.REPLACEMENTS), getAll(COLLECTIONS.SHIFTS)]);
  const valid = new Set(shifts.map(s => Number(s.id)));
  const orphans = replacements.filter(r => !valid.has(Number(r.shift_id)));
  await commitOps(orphans.map(r => ({ type: 'delete', ref: docRef(COLLECTIONS.REPLACEMENTS, r._docId) })));
  res.json({ message: `נמחקו ${orphans.length} החלפות יתומות.` });
});

router.put('/shift-exemptions/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const existing = await getById(COLLECTIONS.REPLACEMENTS, req.params.id);
  assertSameOrg(existing, orgId, 'ההחלפה');
  const data = await validated(orgId, { ...req.body, shift_id: existing.shift_id }, existing);
  await docRef(COLLECTIONS.REPLACEMENTS, existing._docId).update(data);
  res.json({ message: 'ההחלפה עודכנה' });
});

router.delete('/shift-exemptions/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const existing = await getById(COLLECTIONS.REPLACEMENTS, req.params.id);
  assertSameOrg(existing, orgId, 'ההחלפה');
  await docRef(COLLECTIONS.REPLACEMENTS, existing._docId).delete();
  res.json({ message: 'נמחק בהצלחה' });
});

export default router;
