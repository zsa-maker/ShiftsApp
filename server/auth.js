import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { COLLECTIONS, HttpError, getById } from './db.js';

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL = '7d';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET חייב להיות מוגדר בסביבת production');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET לא הוגדר — נוצר מפתח זמני. כל ההתחברויות יתבטלו בהפעלה מחדש של השרת.');
}

export const MIN_PASSWORD_LENGTH = 4;

export function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

export function looksHashed(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

/**
 * בודק סיסמה מול משתמש. תומך גם במשתמשים ישנים שהסיסמה שלהם עדיין
 * שמורה כטקסט גלוי (עד שהמיגרציה תצפין אותם).
 */
export async function verifyPassword(user, plain) {
  const candidate = String(plain ?? '');
  if (user.password_hash && looksHashed(user.password_hash)) {
    return bcrypt.compare(candidate, user.password_hash);
  }
  if (user.password !== undefined && user.password !== null) {
    const stored = String(user.password).trim();
    const a = Buffer.from(stored);
    const b = Buffer.from(candidate.trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

export function validatePassword(plain) {
  const p = String(plain ?? '').trim();
  if (p.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`);
  }
  return p;
}

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, { expiresIn: TOKEN_TTL });
}

export function signState(payload, expiresIn = '10m') {
  return jwt.sign(payload, jwtSecret, { expiresIn });
}

export function verifyState(token) {
  return jwt.verify(token, jwtSecret);
}

// טוען את המשתמש מחדש מ-Firestore בכל בקשה: שינוי תפקיד או מחיקה נכנסים לתוקף מיד
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'יש להתחבר למערכת'));
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return next(new HttpError(401, 'פג תוקף ההתחברות, יש להתחבר מחדש'));
  }
  const user = await getById(COLLECTIONS.USERS, payload.sub);
  if (!user || Number(user.is_active) === 0) {
    return next(new HttpError(401, 'המשתמש אינו פעיל'));
  }
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'אין לך הרשאה לפעולה זו'));
    }
    next();
  };
}

export const requireAdmin = requireRole('admin', 'super_admin');
export const requireSuperAdmin = requireRole('super_admin');

export function isAdmin(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

/**
 * קובע לאיזה ארגון הבקשה שייכת.
 * משתמש רגיל/אחראי — תמיד הארגון שלו (מתעלמים ממה שנשלח).
 * מנהל-על — חייב לציין org_id.
 */
export function resolveOrgId(req) {
  if (req.user.role === 'super_admin') {
    const requested = Number(req.query.org_id ?? req.body?.organization_id ?? req.body?.org_id ?? req.params?.orgId);
    if (!requested) throw new HttpError(400, 'חסר מזהה טייסת');
    return requested;
  }
  const own = Number(req.user.organization_id);
  if (!own) throw new HttpError(403, 'המשתמש אינו משויך לטייסת');
  return own;
}

export function assertSameOrg(doc, orgId, what = 'הרשומה') {
  if (!doc || Number(doc.organization_id) !== Number(orgId)) {
    throw new HttpError(404, `${what} לא נמצאה`);
  }
}
