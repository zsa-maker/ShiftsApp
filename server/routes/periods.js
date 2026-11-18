import { Router } from 'express';
import { COLLECTIONS, HttpError, allocateIds, commitOps, docRef, getByOrg, stripInternal } from '../db.js';
import { requireAuth, requireAdmin, resolveOrgId } from '../auth.js';
import { cleanDate, defaultPeriods, validatePeriods } from '../../shifts-client/src/shared/rules.js';

const router = Router();

// :orgId נשמר בנתיב לתאימות; למשתמש רגיל תמיד נעשה שימוש בטייסת שלו
router.get(['/periods', '/periods/:orgId'], requireAuth, async (req, res) => {
  const orgId = resolveOrgId(req);
  const periods = await getByOrg(COLLECTIONS.PERIODS, orgId);
  const list = periods.length ? periods.map(stripInternal) : defaultPeriods();
  list.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  res.json(list);
});

// מחליף את כל התקופות של הטייסת בפעולה אחת (מחיקה + יצירה באותו באץ')
router.post('/periods', requireAuth, requireAdmin, async (req, res) => {
  const orgId = resolveOrgId(req);
  const incoming = req.body.periods;
  const error = validatePeriods(incoming);
  if (error) throw new HttpError(400, error);

  const existing = await getByOrg(COLLECTIONS.PERIODS, orgId);
  const ids = await allocateIds(COLLECTIONS.PERIODS, incoming.length);
  await commitOps([
    ...existing.map(p => ({ type: 'delete', ref: docRef(COLLECTIONS.PERIODS, p._docId) })),
    ...incoming.map((p, i) => ({
      type: 'set',
      ref: docRef(COLLECTIONS.PERIODS, ids[i]),
      data: {
        id: ids[i],
        organization_id: orgId,
        name: String(p.name).trim(),
        start_date: cleanDate(p.start_date || p.startDate),
        end_date: cleanDate(p.end_date || p.endDate)
      }
    }))
  ]);
  res.json({ message: 'התקופות נשמרו בהצלחה!' });
});

export default router;
