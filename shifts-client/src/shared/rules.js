// ============================================================================
// חוקי מערכת משותפים — הקובץ הזה נטען גם בדפדפן (Vite) וגם בשרת (Node).
// כל חישוב של תאריכים, זכאות לשיבוץ ונקודות נעשה כאן בלבד,
// כדי שהלקוח והשרת יגיעו תמיד לאותה תוצאה.
// אין כאן תלות בספריות חיצוניות ואין שימוש באזור הזמן המקומי:
// תאריכים מיוצגים כמחרוזות 'YYYY-MM-DD' ומחושבים ב-UTC.
// ============================================================================

export const ISRAEL_TZ = 'Asia/Jerusalem';
export const ASSIGNMENT_BUFFER_DAYS = 5;

// מזהי פטורים קבועים (טבלת Exemption_Types) + מילות מפתח בשם הפטור/התורנות
export const EXEMPTIONS = {
  KITCHEN: { id: 1, keywords: ['מטבח'] },
  GUARD: { id: 2, keywords: ['שמיר'] },
  RASAR: { id: 3, keywords: ['רס"ר', 'רסר'] },
  SHABBAT: { id: 4, keywords: ['שבת'] }
};

// ---------------------------------------------------------------------------
// תאריכים
// ---------------------------------------------------------------------------

export function cleanDate(value) {
  if (!value) return '';
  const str = String(value).split('T')[0].trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : '';
}

function toUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const s = cleanDate(dateStr);
  if (!s) return '';
  return fromUtc(toUtc(s) + days * 86400000);
}

export function dayOfWeek(dateStr) {
  const s = cleanDate(dateStr);
  return s ? new Date(toUtc(s)).getUTCDay() : -1; // 0 = ראשון ... 6 = שבת
}

export function daysInclusive(startStr, endStr) {
  const s = cleanDate(startStr);
  const e = cleanDate(endStr);
  if (!s || !e || e < s) return 0;
  return Math.round((toUtc(e) - toUtc(s)) / 86400000) + 1;
}

export function eachDay(startStr, endStr) {
  const s = cleanDate(startStr);
  const e = cleanDate(endStr);
  const days = [];
  if (!s || !e || e < s) return days;
  for (let ms = toUtc(s); ms <= toUtc(e); ms += 86400000) days.push(fromUtc(ms));
  return days;
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = cleanDate(aStart), ae = cleanDate(aEnd), bs = cleanDate(bStart), be = cleanDate(bEnd);
  if (!as || !ae || !bs || !be) return false;
  return as <= be && ae >= bs;
}

export function rangeContainsShabbat(startStr, endStr) {
  return eachDay(startStr, endStr).some(d => dayOfWeek(d) === 6);
}

// התאריך של היום לפי שעון ישראל (ולא לפי UTC)
export function todayInIsrael(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

export function isValidRange(startStr, endStr) {
  const s = cleanDate(startStr);
  const e = cleanDate(endStr);
  return Boolean(s && e && s <= e);
}

// ---------------------------------------------------------------------------
// תקופות
// ---------------------------------------------------------------------------

export function fallbackPeriodName(dateStr) {
  const s = cleanDate(dateStr);
  if (!s) return '';
  const [y, m] = s.split('-').map(Number);
  return `${m <= 6 ? '1' : '2'}.${String(y).slice(-2)}`;
}

// periods: [{ name, start_date|startDate, end_date|endDate }]
export function getPeriodName(dateStr, periods = []) {
  const s = cleanDate(dateStr);
  if (!s) return '';
  const match = periods.find(p => {
    const ps = cleanDate(p.start_date || p.startDate);
    const pe = cleanDate(p.end_date || p.endDate);
    return ps && pe && s >= ps && s <= pe;
  });
  return match ? match.name : fallbackPeriodName(s);
}

// תקופות ברירת מחדל (חצאי שנה) סביב התאריך הנוכחי
export function defaultPeriods(today = todayInIsrael()) {
  const year = Number(today.slice(0, 4));
  const result = [];
  for (const y of [year - 1, year, year + 1]) {
    const yy = String(y).slice(-2);
    result.push({ name: `1.${yy}`, start_date: `${y}-01-01`, end_date: `${y}-06-30` });
    result.push({ name: `2.${yy}`, start_date: `${y}-07-01`, end_date: `${y}-12-31` });
  }
  return result;
}

export function validatePeriods(periods) {
  if (!Array.isArray(periods)) return 'רשימת התקופות אינה תקינה';
  const names = new Set();
  const clean = [];
  for (const p of periods) {
    const name = String(p.name || '').trim();
    const s = cleanDate(p.start_date || p.startDate);
    const e = cleanDate(p.end_date || p.endDate);
    if (!name) return 'לכל תקופה חייב להיות שם';
    if (names.has(name)) return `שם התקופה "${name}" מופיע פעמיים`;
    if (!s || !e) return `חסרים תאריכים בתקופה ${name}`;
    if (e < s) return `בתקופה ${name} תאריך הסיום לפני תאריך ההתחלה`;
    names.add(name);
    clean.push({ name, s, e });
  }
  clean.sort((a, b) => a.s.localeCompare(b.s));
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].s <= clean[i - 1].e) {
      return `התקופות ${clean[i - 1].name} ו-${clean[i].name} חופפות`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// סוגי תורנות ופטורים
// ---------------------------------------------------------------------------

export function isGuardType(type) {
  return Boolean(type?.name && type.name.includes('שמיר'));
}

export function isKitchenType(type) {
  return Boolean(type?.name && type.name.includes('מטבח'));
}

export function isRasarType(type) {
  return Boolean(type?.name && (type.name.includes('רס"ר') || type.name.includes('רסר')));
}

export function getUserExemptionIds(user) {
  if (!user) return [];
  const raw = Array.isArray(user.exemptionIds) ? user.exemptionIds : [];
  return [...new Set(raw.map(Number).filter(n => !Number.isNaN(n)))];
}

export function userHasExemption(user, exemptionTypes, exemption) {
  const ids = getUserExemptionIds(user);
  if (ids.includes(exemption.id)) return true;
  const names = ids
    .map(id => (exemptionTypes || []).find(et => Number(et.id) === id)?.name || '')
    .filter(Boolean);
  return names.some(name => exemption.keywords.some(k => name.includes(k)));
}

// ---------------------------------------------------------------------------
// אילוצים
// ---------------------------------------------------------------------------

function normalizeDivision(value) {
  const v = value === undefined || value === null ? '' : String(value).trim();
  return v === 'לא מוגדר' ? '' : v;
}

// איזה סוג אילוץ זה: soldier / division / squadron
export function constraintKind(c) {
  if (c.constraint_type === 'soldier' || c.constraint_type === 'division' || c.constraint_type === 'squadron') {
    return c.constraint_type;
  }
  if (c.user_id) return 'soldier';
  if (normalizeDivision(c.division)) return 'division';
  return 'squadron';
}

export function constraintAppliesToUser(c, user) {
  const kind = constraintKind(c);
  if (kind === 'soldier') return Boolean(c.user_id) && Number(c.user_id) === Number(user.id);
  if (kind === 'division') {
    const cDiv = normalizeDivision(c.division);
    const uDiv = normalizeDivision(user.division);
    return Boolean(cDiv) && cDiv === uDiv;
  }
  return true; // כל הטייסת
}

// ---------------------------------------------------------------------------
// בדיקת זכאות לשיבוץ
// ---------------------------------------------------------------------------

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkEligibility({ user, startDate, endDate, shiftType, exemptionTypes = [], constraints = [] }) {
  if (!user) return { ok: false, reason: 'החייל לא נמצא' };
  const s = cleanDate(startDate);
  const e = cleanDate(endDate);
  if (!s || !e) return { ok: false, reason: 'תאריכי התורנות אינם תקינים' };
  if (e < s) return { ok: false, reason: 'תאריך הסיום לפני תאריך ההתחלה' };

  // 1. תאריך שחרור — מותר לסיים תורנות ביום השחרור עצמו
  const release = cleanDate(user.release_date);
  if (release && e > release) {
    return { ok: false, reason: `${user.full_name} משתחרר/ת בתאריך ${release}, לפני סיום התורנות` };
  }

  // 2. מגדר
  const genderLimit = shiftType?.gender_limit || 'all';
  if (genderLimit !== 'all' && user.gender && user.gender !== genderLimit) {
    return { ok: false, reason: `תורנות זו מוגדרת עבור ${genderLimit === 'male' ? 'בנים בלבד' : 'בנות בלבד'}` };
  }

  // 3. פטור שבתות — לפי ימי השבוע בפועל בטווח
  if (rangeContainsShabbat(s, e) && userHasExemption(user, exemptionTypes, EXEMPTIONS.SHABBAT)) {
    return { ok: false, reason: `ל-${user.full_name} יש פטור שבתות` };
  }

  // 4. פטורים לפי סוג תורנות
  if (isKitchenType(shiftType) && userHasExemption(user, exemptionTypes, EXEMPTIONS.KITCHEN)) {
    return { ok: false, reason: `ל-${user.full_name} יש פטור מטבח` };
  }
  if (isGuardType(shiftType) && userHasExemption(user, exemptionTypes, EXEMPTIONS.GUARD)) {
    return { ok: false, reason: `ל-${user.full_name} יש פטור שמירות` };
  }
  if (isRasarType(shiftType) && userHasExemption(user, exemptionTypes, EXEMPTIONS.RASAR)) {
    return { ok: false, reason: `ל-${user.full_name} יש פטור רס"ר` };
  }

  // 5. אילוצים
  const blocking = constraints.find(c =>
    rangesOverlap(s, e, c.start_date, c.end_date) && constraintAppliesToUser(c, user)
  );
  if (blocking) {
    return { ok: false, reason: `קיים אילוץ בתאריכים אלו (${blocking.reason || 'חסימת לוח'})` };
  }

  return { ok: true };
}

// האם לחייל יש תורנות אחרת קרובה מדי (מרווח מינימלי בין תורנויות)
export function hasNearbyShift({ userId, startDate, endDate, shifts, excludeShiftId = null, bufferDays = ASSIGNMENT_BUFFER_DAYS }) {
  const s = addDays(startDate, -bufferDays);
  const e = addDays(endDate, bufferDays);
  return shifts.some(other =>
    other.user_id !== null && other.user_id !== undefined &&
    Number(other.user_id) === Number(userId) &&
    (excludeShiftId === null || Number(other.id) !== Number(excludeShiftId)) &&
    rangesOverlap(s, e, other.start_date, other.end_date)
  );
}

// ---------------------------------------------------------------------------
// נקודות — חישוב אחד לכל המערכת
// ---------------------------------------------------------------------------

// החלפות שמורידות נקודות מהחייל המקורי
export function isCreditReplacement(r) {
  return r && (r.type === 'pet' || r.type === 'squadron');
}

/**
 * ערך הנקודות של יום אחד בתורנות.
 * שמירות: יום ראשון ויום אחרון = חצי. מטבח: חמישי (רגיל) / שני (סופ"ש) = חצי.
 */
export function dailyPointValue({ shiftType, dateStr, dayIndex, totalDays, isWeekend }) {
  const base = Number(shiftType?.points_base);
  const basePoints = Number.isFinite(base) && base > 0 ? base : 1;
  if (isGuardType(shiftType)) {
    if (dayIndex === 0 || dayIndex === totalDays - 1) return 0.5 * basePoints;
  } else if (isKitchenType(shiftType)) {
    const dow = dayOfWeek(dateStr);
    if ((!isWeekend && dow === 4) || (isWeekend && dow === 1)) return 0.5 * basePoints;
  }
  return basePoints;
}

function isDayCovered(dateStr, replacements) {
  return replacements.some(r => {
    const rs = cleanDate(r.start_date);
    const re = cleanDate(r.end_date);
    return rs && re && dateStr >= rs && dateStr <= re;
  });
}

/**
 * נקודות נטו לתורנות: סכום הימים פחות ימים שכוסו ע"י החלפת פט/טייסת.
 * shift: { id, start_date, end_date, is_weekend }
 */
export function computeShiftPoints(shift, shiftType, replacements = []) {
  const days = eachDay(shift.start_date, shift.end_date);
  const relevant = replacements.filter(r => Number(r.shift_id) === Number(shift.id) && isCreditReplacement(r));
  const isWeekend = Number(shift.is_weekend) === 1 || shift.is_weekend === true;
  let total = 0;
  days.forEach((dateStr, dayIndex) => {
    if (isDayCovered(dateStr, relevant)) return;
    total += dailyPointValue({ shiftType, dateStr, dayIndex, totalDays: days.length, isWeekend });
  });
  return Number(total.toFixed(2));
}

/**
 * סטטיסטיקה לחייל מתוך רשימת תורנויות (כבר מסוננת לתקופה).
 * shosh  = סופ"ש שמתחיל בשישי (שישי-שבת).
 * mkutzarot = סופ"ש מקוצר.
 *  - ללא החלפה: תורנות שמתחילה בראשון = מקוצרת, תורנות שמסתיימת בשישי = שוש.
 *  - עם החלפת פט שמכסה שבת: ההחלפה מתחילה בשישי = שוש, ההחלפה מסתיימת בשבת = מקוצרת.
 */
export function computeUserStats(userId, shifts, shiftTypes, replacements = []) {
  const stats = { netPoints: 0, netShabbats: 0, shabbatExemptionPoints: 0, shosh: 0, mkutzarot: 0, baltams: 0 };
  shifts
    .filter(s => s.user_id !== null && s.user_id !== undefined && Number(s.user_id) === Number(userId))
    .forEach(s => {
      const type = shiftTypes.find(t => Number(t.id) === Number(s.shift_type_id));
      const shiftReplacements = replacements.filter(r => Number(r.shift_id) === Number(s.id));
      const days = eachDay(s.start_date, s.end_date);

      stats.netPoints += computeShiftPoints(s, type, replacements);
      if (Number(s.is_baltam) === 1 || s.is_baltam === true) stats.baltams += 1;

      days.forEach(d => {
        if (dayOfWeek(d) !== 6) return;
        if (isDayCovered(d, shiftReplacements)) stats.shabbatExemptionPoints += 1;
        else stats.netShabbats += 1;
      });

      const petWeekend = shiftReplacements.find(r => r.type === 'pet' && rangeContainsShabbat(r.start_date, r.end_date));
      if (petWeekend) {
        if (dayOfWeek(petWeekend.start_date) === 5) stats.shosh += 1;
        if (dayOfWeek(petWeekend.end_date) === 6) stats.mkutzarot += 1;
      } else {
        if (dayOfWeek(s.start_date) === 0) stats.mkutzarot += 1;
        if (dayOfWeek(s.end_date) === 5) stats.shosh += 1;
      }
    });
  stats.netPoints = Number(stats.netPoints.toFixed(2));
  return stats;
}

// אחוז פוטנציאל: 0 הוא ערך חוקי (לא משתתף), רק ערך חסר הופך ל-100
export function potentialOf(user) {
  const n = Number(user?.potential_reduction);
  if (user?.potential_reduction === null || user?.potential_reduction === undefined || user?.potential_reduction === '' || Number.isNaN(n)) {
    return 100;
  }
  return Math.min(100, Math.max(0, n));
}

export function isInRotation(user) {
  return Boolean(user) &&
    Number(user.is_active) === 1 &&
    Number(user.does_shifts) === 1 &&
    user.role !== 'super_admin';
}
