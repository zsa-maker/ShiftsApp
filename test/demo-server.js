// שרת הדגמה מקומי עם נתונים בזיכרון — לבדיקה ידנית של הממשק בלי Firebase:
//   npm run build && node test/demo-server.js
// משתמשים: מנהל-על "על"/root1, אחראית "אחראית"/admin1, חייל "חייל א"/pass1
process.env.SHIFTS_TEST_DB = 'memory';
process.env.JWT_SECRET ||= 'demo-secret';

const { db } = await import('./fake-firestore.js');
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations.js');
const { addDays, todayInIsrael } = await import('../shifts-client/src/shared/rules.js');

const d = n => addDays(todayInIsrael(), n);
const put = (col, id, data) => db.col(col).set(String(id), data);

put('Organizations', 1, { id: 1, name: 'טייסת הדגמה' });
put('Users', 1, { id: 1, full_name: 'על', password: 'root1', role: 'super_admin', is_active: 1, does_shifts: 0 });
put('Users', 2, { id: 2, full_name: 'אחראית', password: 'admin1', role: 'admin', organization_id: 1, is_active: 1, does_shifts: 0 });
['חייל א', 'חייל ב', 'חיילת ג', 'חייל ד'].forEach((name, i) => put('Users', 3 + i, {
  id: 3 + i, full_name: name, password: `pass${i + 1}`, role: 'soldier', organization_id: 1, is_active: 1, does_shifts: 1,
  potential_reduction: i === 3 ? 50 : 100, division: i < 2 ? 'מבצעים' : 'טכני', gender: i === 2 ? 'female' : 'male'
}));
put('User_Exemptions', 1, { id: 1, user_id: 5, exemption_type_id: 4 });
[[1, 'פטור מטבח'], [2, 'פטור שמירות'], [3, 'פטור רס"ר'], [4, 'פטור שבתות']].forEach(([id, name]) => put('Exemption_Types', id, { id, name }));
put('Shift_Types', 1, { id: 1, organization_id: 1, name: 'שמירות', points_base: 1, color: '#27ae60', gender_limit: 'all' });
put('Shift_Types', 2, { id: 2, organization_id: 1, name: 'מטבח', points_base: 1, color: '#8e44ad', gender_limit: 'all' });
put('Shifts', 1, { id: 1, organization_id: 1, user_id: 3, shift_type_id: 1, start_date: d(-10), end_date: d(-7), is_weekend: 0, is_published: 1 });
put('Shifts', 2, { id: 2, organization_id: 1, user_id: 4, shift_type_id: 2, start_date: d(2), end_date: d(6), is_weekend: 0, is_published: 1 });
put('Shifts', 3, { id: 3, organization_id: 1, user_id: null, shift_type_id: 1, start_date: d(9), end_date: d(12), is_weekend: 0, is_published: 0 });
put('Constraints', 1, { id: 1, organization_id: 1, user_id: 6, start_date: d(9), end_date: d(11), reason: 'קורס' });

await runMigrations();
const port = process.env.PORT || 3001;
createApp().listen(port, () => console.log(`demo server on http://localhost:${port}`));
