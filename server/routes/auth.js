import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, HttpError, docRef, getById, getWhere, publicUser } from '../db.js';
import { requireAuth, signToken, verifyPassword, hashPassword, validatePassword } from '../auth.js';
import { isNameTaken } from '../services.js';

const router = Router();

// פרטי המשתמש המחובר + שם הטייסת שלו (לכותרת במסך)
async function sessionUser(user) {
  const result = publicUser(user);
  if (user.organization_id) {
    const org = await getById(COLLECTIONS.ORGS, user.organization_id);
    result.organization_name = org?.name || null;
  }
  return result;
}

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const fullName = String(req.body?.full_name || '').trim();
  const password = String(req.body?.password || '');
  if (!fullName || !password) throw new HttpError(400, 'יש למלא שם משתמש וסיסמה');

  const candidates = (await getWhere(COLLECTIONS.USERS, 'full_name', fullName))
    .filter(u => Number(u.is_active) !== 0);

  let user = null;
  for (const c of candidates) {
    if (await verifyPassword(c, password)) { user = c; break; }
  }
  if (!user) throw new HttpError(401, 'שם משתמש או סיסמה שגויים');

  // משתמש ישן שהסיסמה שלו עדיין גלויה — מצפינים עכשיו
  if (!user.password_hash) {
    await docRef(COLLECTIONS.USERS, user._docId).update({
      password_hash: await hashPassword(password.trim()),
      password: FieldValue.delete()
    });
  }

  res.json({ token: signToken(user), user: await sessionUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await sessionUser(req.user) });
});

// עדכון הפרטים של המשתמש המחובר בלבד
router.put('/me', requireAuth, async (req, res) => {
  const update = {};
  if (req.body.full_name !== undefined) {
    const name = String(req.body.full_name).trim();
    if (!name) throw new HttpError(400, 'השם לא יכול להיות ריק');
    if (name !== req.user.full_name && await isNameTaken(name, req.user.id)) {
      throw new HttpError(409, 'כבר קיים משתמש עם השם הזה');
    }
    update.full_name = name;
  }
  if (req.body.password !== undefined && String(req.body.password).trim() !== '') {
    update.password_hash = await hashPassword(validatePassword(req.body.password));
  }
  if (req.body.does_shifts !== undefined && req.user.role !== 'super_admin') {
    update.does_shifts = (req.body.does_shifts === true || Number(req.body.does_shifts) === 1) ? 1 : 0;
  }
  if (Object.keys(update).length) {
    await docRef(COLLECTIONS.USERS, req.user._docId).update(update);
  }
  res.json({ message: 'הפרטים עודכנו בהצלחה!', user: await sessionUser({ ...req.user, ...update }) });
});

export default router;
