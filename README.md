# תורנויHOT — מערכת תורנויות

React (Vite) + שרת Express עם Firebase Admin. **הדפדפן לא ניגש ל-Firestore ישירות** — כל בקשה עוברת דרך השרת, שבודק התחברות, תפקיד ושייכות לטייסת.

## מבנה

```
server.js                  נקודת כניסה: מיגרציה חד-פעמית ואז הפעלת השרת
server/
  app.js                   Express: נתיבים, CORS, הגשת ה-frontend, טיפול בשגיאות
  auth.js                  bcrypt + JWT, בדיקות תפקיד ושייכות לטייסת
  db.js                    עזרי Firestore: מזהים אטומיים, באצ'ים מחולקים, סינון שדות סודיים
  migrations.js            הצפנת סיסמאות, איחוד פטורים, ניקוי טיפוסים (רץ פעם אחת)
  calendar.js              סנכרון תורנויות מפורסמות ליומן גוגל
  routes/                  auth, organizations, users, shifts, replacements, constraints, periods, calendar
shifts-client/
  src/shared/rules.js      חוקי זכאות, תאריכים ונקודות — משותף ללקוח ולשרת
  src/api.js               fetch עם טוקן וטיפול בשגיאות
  src/holidays.js          חגים מ-Hebcal, בקשה אחת לשנה
firestore.rules            חוסם כל גישה ישירה מהדפדפן
test/                      בדיקות (npm test) + שרת הדגמה בזיכרון
```

## הרצה מקומית

```bash
cp .env.example .env            # למלא JWT_SECRET ו-FIREBASE_SERVICE_ACCOUNT (או לשים serviceAccountKey.json)
npm install
npm run dev                     # שרת על פורט 3001
cd shifts-client && npm install && npm run dev   # ממשק על 5173, /api עובר לשרת אוטומטית
```

בלי Firebase בכלל (נתוני הדגמה בזיכרון):

```bash
npm install && npm run build && node test/demo-server.js
# http://localhost:3001  —  על/root1 · אחראית/admin1 · חייל א/pass1
```

בדיקות: `npm test`

## העלאה לאוויר

השרת מגיש גם את ה-API וגם את הממשק הבנוי, לכן מספיק שירות Node אחד (Render, Railway, Fly.io, Cloud Run):

- Build: `npm install && npm run build`
- Start: `npm start`
- משתני סביבה: `JWT_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `NODE_ENV=production`, ולסנכרון יומן `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI=https://<השרת>/api/calendar/auth/callback`

אם רוצים להמשיך להגיש את הממשק מ-Firebase Hosting: לבנות עם `VITE_API_BASE=https://<השרת> npm run build` בתוך `shifts-client`, ולהגדיר בשרת `CORS_ORIGINS=https://toranoot.web.app`.

### סדר מעבר מהגרסה הקודמת

1. להחליף את ה-Google Client Secret ב-Google Cloud Console (הקובץ `.env` הישן היה ב-git).
2. להעלות את השרת. בעלייה הראשונה הוא מריץ מיגרציה: מצפין את כל הסיסמאות, ממזג את `User_Exemptions` לתוך המשתמשים ומנקה נתונים. הסיסמאות של המשתמשים לא משתנות.
3. רק אחרי שהשרת עובד: `npx firebase deploy --only firestore:rules` — מכאן אף אחד לא יכול לקרוא את מסד הנתונים מהדפדפן.
4. אם המאגר ב-GitHub ציבורי: ההיסטוריה עדיין מכילה את `.env` ואת `shifts.db` עם סיסמאות גלויות. לבקש מהמשתמשים להחליף סיסמה, ואם אפשר לנקות את ההיסטוריה (`git filter-repo`).
