import { eachDay } from './shared/rules.js';

// חגים מ-Hebcal: בקשה אחת לכל שנה (במקום בקשה לכל תורנות), נשמרת בזיכרון
const yearCache = new Map();

// לפי לוח החגים בישראל (i=on). שמות באנגלית מ-Hebcal, ממופים לשמות שהמערכת סופרת.
// "ערב חג" לא נספר. "פסח ב'" = שביעי של פסח (יום טוב שני בישראל).
function normalizeHoliday(item) {
  const title = String(item.title || '');
  if (/^Erev /i.test(title)) return null;
  if (/^Rosh Hashana/i.test(title)) return 'ראש השנה';
  if (/^Yom Kippur/i.test(title)) return 'יום כיפור';
  if (/^Sukkot/i.test(title)) return 'סוכות';
  if (/^Shavuot/i.test(title)) return 'שבועות';
  if (/^Pesach I$/i.test(title)) return "פסח א'";
  if (/^Pesach VII$/i.test(title)) return "פסח ב'";
  return null;
}

function loadYear(year) {
  if (!yearCache.has(year)) {
    const promise = fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&maj=on&i=on`)
      .then(res => (res.ok ? res.json() : { items: [] }))
      .then(data => {
        const byDate = new Map();
        (data.items || []).forEach(item => {
          const name = normalizeHoliday(item);
          if (name && item.date) byDate.set(String(item.date).slice(0, 10), name);
        });
        return byDate;
      })
      .catch(err => {
        console.error('שגיאה בשליפת חגים:', err);
        // לא מנסים שוב לכל תורנות — רק אחרי דקה
        setTimeout(() => yearCache.delete(year), 60000);
        return new Map();
      });
    yearCache.set(year, promise);
  }
  return yearCache.get(year);
}

export async function prefetchHolidayYears(dateStrings) {
  const years = new Set(dateStrings.filter(Boolean).map(d => String(d).slice(0, 4)));
  await Promise.all([...years].map(loadYear));
}

// מחזיר "ראש השנה, יום כיפור" או null
export async function getHolidayNameForRange(startStr, endStr) {
  const days = eachDay(startStr, endStr || startStr);
  if (!days.length) return null;
  await prefetchHolidayYears(days);
  const names = [];
  for (const day of days) {
    const name = (await loadYear(day.slice(0, 4))).get(day);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names.join(', ') : null;
}
