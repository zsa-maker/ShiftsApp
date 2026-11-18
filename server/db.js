import { db } from './firebase.js';

export const COLLECTIONS = {
  ORGS: 'Organizations',
  USERS: 'Users',
  SHIFT_TYPES: 'Shift_Types',
  SHIFTS: 'Shifts',
  EXEMPTION_TYPES: 'Exemption_Types',
  USER_EXEMPTIONS: 'User_Exemptions', // ישן — מוזג לתוך Users.exemptionIds במיגרציה
  CONSTRAINTS: 'Constraints',
  REPLACEMENTS: 'Shift_Exemptions',
  PERIODS: 'Periods'
};

const BATCH_LIMIT = 450; // מתחת למגבלת 500 הפעולות של Firestore

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function toDoc(snap) {
  const data = snap.data();
  const numericId = Number(snap.id);
  return {
    ...data,
    id: data.id !== undefined ? data.id : (Number.isNaN(numericId) ? snap.id : numericId),
    _docId: snap.id
  };
}

export function stripInternal(obj) {
  if (!obj) return obj;
  const { _docId, ...rest } = obj;
  return rest;
}

export function docRef(collection, id) {
  return db.collection(collection).doc(String(id));
}

export async function getById(collection, id) {
  if (id === undefined || id === null || id === '') return null;
  const snap = await docRef(collection, id).get();
  return snap.exists ? toDoc(snap) : null;
}

export async function getAll(collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map(toDoc);
}

// כל המסמכים של ארגון אחד (organization_id נשמר תמיד כמספר אחרי המיגרציה)
export async function getByOrg(collection, orgId) {
  const snap = await db.collection(collection).where('organization_id', '==', Number(orgId)).get();
  return snap.docs.map(toDoc);
}

export async function getWhere(collection, field, value) {
  const snap = await db.collection(collection).where(field, '==', value).get();
  return snap.docs.map(toDoc);
}

/**
 * הקצאת מזהים מספריים רצים בצורה אטומית (טרנזקציה על מונה),
 * כך ששני משתמשים שיוצרים רשומה באותו רגע לא יקבלו אותו מזהה.
 */
export async function allocateIds(collection, count = 1) {
  if (count <= 0) return [];
  const counterRef = db.collection('_counters').doc(collection);
  const first = await db.runTransaction(async tx => {
    const counterSnap = await tx.get(counterRef);
    let next;
    if (counterSnap.exists) {
      next = Number(counterSnap.data().next) || 1;
    } else {
      // אתחול חד-פעמי מהמזהה הגבוה ביותר שקיים כבר באוסף
      const all = await tx.get(db.collection(collection).select('id'));
      let max = 0;
      all.forEach(d => {
        const n = Number(d.get('id') ?? d.id);
        if (!Number.isNaN(n) && n > max) max = n;
      });
      next = max + 1;
    }
    tx.set(counterRef, { next: next + count }, { merge: true });
    return next;
  });
  return Array.from({ length: count }, (_, i) => first + i);
}

export async function allocateId(collection) {
  const [id] = await allocateIds(collection, 1);
  return id;
}

/**
 * כתיבה של מספר לא מוגבל של פעולות, מחולקות לבאצ'ים של עד 450 פעולות.
 * ops: [{ type: 'set'|'update'|'delete', ref, data, options }]
 */
export async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(i, i + BATCH_LIMIT).forEach(op => {
      if (op.type === 'set') batch.set(op.ref, op.data, op.options || {});
      else if (op.type === 'update') batch.update(op.ref, op.data);
      else if (op.type === 'delete') batch.delete(op.ref);
    });
    await batch.commit();
  }
  return ops.length;
}

// שדות שלעולם לא יוצאים מהשרת
const SECRET_FIELDS = ['password', 'password_hash', 'google_refresh_token'];

export function publicUser(user) {
  if (!user) return null;
  const clean = stripInternal(user);
  SECRET_FIELDS.forEach(f => delete clean[f]);
  clean.calendar_connected = Boolean(user.google_refresh_token);
  clean.exemptionIds = Array.isArray(user.exemptionIds) ? user.exemptionIds.map(Number) : [];
  clean.exemption_ids = clean.exemptionIds.join(',');
  return clean;
}

// מה שחייל רגיל רשאי לראות על חיילים אחרים
export function limitedUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
    does_shifts: user.does_shifts,
    potential_reduction: user.potential_reduction
  };
}

export { db };
