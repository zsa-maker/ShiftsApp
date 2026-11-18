import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateId, docRef, getById, getByOrg, stripInternal } from '../db.js';
import { requireAuth, requireAdmin, resolveOrgId, assertSameOrg, isAdmin } from '../auth.js';
import { cleanDate, constraintKind } from '../../shifts-client/src/shared/rules.js';

const router = Router();

router.get('/constraints', requireAuth, async (req, res) => {
  const orgId = resolveOrgId(req);
  const [constraints, users] = await Promise.all([
    getByOrg(COLLECTIONS.CONSTRAINTS, orgId),
    getByOrg(COLLECTIONS.USERS, orgId)
  ]);
  // חייל רואה רק את האילוצים שלו, של הגף שלו ושל כל הטייסת (לא סיבות של חיילים אחרים)
  const visible = isAdmin(req.user) ? constraints : constraints.filter(c => {
    const kind = constraintKind(c);
    if (kind === 'soldier') return Number(c.user_id) === Number(req.user.id);
    if (kind === 'division') return String(c.division || '').trim() === String(req.user.division || '').trim();
    return true;
  });
  res.json(visible.map(c => {
    const u = c.user_id ? users.find(x => Number(x.id) === Number(c.user_id)) : null;
    return { ...stripInternal(c), constraint_type: constraintKind(c), full_name: u ? u.full_name : null };
  }));
});

router.post('/constraints', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const start = cleanDate(req.body.start_date);
  const end = cleanDate(req.body.end_date);
  if (!start || !end) throw new HttpError(400, 'חובה למלא תאריכים');
  if (end < start) throw new HttpError(400, 'תאריך הסיום לפני תאריך ההתחלה');

  const kind = req.body.constraint_type;
  if (!['soldier', 'division', 'squadron'].includes(kind)) throw new HttpError(400, 'יש לבחור סוג אילוץ');

  let userId = null;
  let division = null;
  if (kind === 'soldier') {
    const user = await getById(COLLECTIONS.USERS, req.body.user_id);
    if (!user || Number(user.organization_id) !== orgId) throw new HttpError(400, 'יש לבחור חייל מהטייסת');
    userId = Number(user.id);
  } else if (kind === 'division') {
    division = String(req.body.division || '').trim();
    if (!division || division === 'לא מוגדר') throw new HttpError(400, 'יש לבחור גף');
  }

  const id = await allocateId(COLLECTIONS.CONSTRAINTS);
  await docRef(COLLECTIONS.CONSTRAINTS, id).set({
    id,
    organization_id: orgId,
    constraint_type: kind,
    user_id: userId,
    division,
    start_date: start,
    end_date: end,
    reason: String(req.body.reason || '').slice(0, 300)
  });
  res.status(201).json({ id, message: 'האילוץ נוצר!' });
});

router.delete('/constraints/:id', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const c = await getById(COLLECTIONS.CONSTRAINTS, req.params.id);
  assertSameOrg(c, orgId, 'האילוץ');
  await docRef(COLLECTIONS.CONSTRAINTS, c._docId).delete();
  res.json({ message: 'האילוץ נמחק!' });
});

export default router;
