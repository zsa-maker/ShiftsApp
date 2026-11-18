import { google } from 'googleapis';
import { COLLECTIONS, getById, getWhere, docRef } from './db.js';
import { addDays, todayInIsrael } from '../shifts-client/src/shared/rules.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getShiftTypesForOrg } from './services.js';

const APP_TAG = 'toranoot';

export function calendarConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// מזהה אירוע קבוע לכל זוג (תורנות, חייל): מותר רק a-v ו-0-9
function eventIdFor(shiftId, userId) {
  return `tor${shiftId}u${userId}`;
}

/**
 * מסנכרן ליומן הגוגל של החייל את כל התורנויות המפורסמות שלו מהיום והלאה,
 * ומוחק אירועים שהמערכת יצרה בעבר ואינם רלוונטיים יותר.
 */
export async function syncUserCalendar(userId) {
  if (!calendarConfigured()) return;
  const user = await getById(COLLECTIONS.USERS, userId);
  if (!user?.google_refresh_token) return;

  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: user.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth });

  const today = todayInIsrael();
  const [shifts, allTypes] = await Promise.all([
    getWhere(COLLECTIONS.SHIFTS, 'user_id', Number(userId)),
    getShiftTypesForOrg(user.organization_id)
  ]);

  const wanted = shifts.filter(s => Number(s.is_published) === 1 && s.end_date >= today);
  const wantedIds = new Set(wanted.map(s => eventIdFor(s.id, userId)));

  try {
    // מחיקת אירועים ישנים של המערכת
    let pageToken;
    do {
      const { data } = await calendar.events.list({
        calendarId: 'primary',
        privateExtendedProperty: [`app=${APP_TAG}`],
        timeMin: new Date(`${today}T00:00:00Z`).toISOString(),
        maxResults: 250,
        singleEvents: true,
        pageToken
      });
      for (const ev of data.items || []) {
        if (!wantedIds.has(ev.id)) {
          await calendar.events.delete({ calendarId: 'primary', eventId: ev.id }).catch(() => {});
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    // יצירה / עדכון של האירועים הנדרשים
    for (const s of wanted) {
      const type = allTypes.find(t => Number(t.id) === Number(s.shift_type_id));
      const eventId = eventIdFor(s.id, userId);
      const body = {
        summary: `תורנות: ${type?.name || 'תורנות'}`,
        description: [s.holiday_name ? `חג: ${s.holiday_name}` : '', s.notes || ''].filter(Boolean).join('\n'),
        start: { date: s.start_date },
        end: { date: addDays(s.end_date, 1) }, // ביומן גוגל תאריך הסיום של אירוע יום-שלם אינו כלול
        status: 'confirmed',
        extendedProperties: { private: { app: APP_TAG, shiftId: String(s.id) } }
      };
      try {
        await calendar.events.update({ calendarId: 'primary', eventId, requestBody: body });
      } catch (err) {
        if (err?.code === 404 || err?.response?.status === 404) {
          await calendar.events.insert({ calendarId: 'primary', requestBody: { ...body, id: eventId } });
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    const msg = err?.response?.data?.error || err?.message || '';
    if (String(msg).includes('invalid_grant')) {
      // החייל ביטל את ההרשאה בגוגל — מנתקים
      await docRef(COLLECTIONS.USERS, userId).update({ google_refresh_token: FieldValue.delete() });
      return;
    }
    console.error(`שגיאה בסנכרון יומן לחייל ${userId}:`, msg);
  }
}

// סנכרון ברקע, עם השהייה קצרה כדי לאחד כמה שינויים רצופים
const pending = new Map();
export function queueCalendarSync(userIds) {
  if (!calendarConfigured()) return;
  [...new Set((userIds || []).filter(Boolean).map(Number))].forEach(uid => {
    clearTimeout(pending.get(uid));
    pending.set(uid, setTimeout(() => {
      pending.delete(uid);
      syncUserCalendar(uid).catch(err => console.error('calendar sync failed', err.message));
    }, 3000));
  });
}
