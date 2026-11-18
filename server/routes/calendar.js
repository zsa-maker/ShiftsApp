import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, HttpError, docRef, getById } from '../db.js';
import { requireAuth, signState, verifyState } from '../auth.js';
import { calendarConfigured, createOAuthClient, syncUserCalendar } from '../calendar.js';

const router = Router();

function page(title, text, ok = true) {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="text-align:center;margin-top:50px;font-family:sans-serif">
<h1 style="color:${ok ? '#28593C' : '#c0392b'}">${title}</h1><h3>${text}</h3></body></html>`;
}

router.get('/calendar/auth-url', requireAuth, (req, res) => {
  if (!calendarConfigured()) throw new HttpError(503, 'חיבור ליומן גוגל לא הוגדר בשרת');
  const url = createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    // state חתום: אי אפשר לקשר יומן למשתמש אחר ע"י שינוי המזהה בכתובת
    state: signState({ uid: String(req.user.id), purpose: 'gcal' })
  });
  res.json({ url });
});

// גוגל מפנה לכאן אחרי אישור — אין כאן כותרת Authorization, לכן מסתמכים על ה-state החתום
router.get('/calendar/auth/callback', async (req, res) => {
  let userId;
  try {
    const state = verifyState(String(req.query.state || ''));
    if (state.purpose !== 'gcal') throw new Error('bad purpose');
    userId = state.uid;
  } catch {
    return res.status(400).send(page('הקישור אינו תקף', 'נסו שוב מתוך המערכת.', false));
  }
  if (req.query.error || !req.query.code) {
    return res.send(page('החיבור בוטל', 'אפשר לסגור את החלון ולחזור למערכת.', false));
  }
  try {
    const user = await getById(COLLECTIONS.USERS, userId);
    if (!user) throw new Error('user not found');
    const { tokens } = await createOAuthClient().getToken(String(req.query.code));
    if (tokens.refresh_token) {
      await docRef(COLLECTIONS.USERS, user._docId).update({ google_refresh_token: tokens.refresh_token });
    }
    syncUserCalendar(user.id).catch(err => console.error('initial calendar sync failed', err.message));
    res.send(page('היומן קושר בהצלחה! 🎉', 'התורנויות המפורסמות שלך יופיעו ביומן תוך דקה. אפשר לסגור את החלון.'));
  } catch (err) {
    console.error('שגיאה בקבלת הטוקנים:', err.message);
    res.status(500).send(page('שגיאה בחיבור ליומן', 'אנא נסו שוב.', false));
  }
});

router.post('/calendar/sync', requireAuth, async (req, res) => {
  if (!req.user.google_refresh_token) throw new HttpError(400, 'היומן אינו מחובר');
  await syncUserCalendar(req.user.id);
  res.json({ message: 'היומן סונכרן' });
});

router.delete('/calendar', requireAuth, async (req, res) => {
  await docRef(COLLECTIONS.USERS, req.user._docId).update({ google_refresh_token: FieldValue.delete() });
  res.json({ message: 'החיבור ליומן נותק' });
});

export default router;
