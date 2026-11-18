// בדיקות קצה-לקצה מול ה-API עם Firestore מדומה בזיכרון
process.env.SHIFTS_TEST_DB = 'memory';
process.env.JWT_SECRET = 'test-secret';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayInIsrael } from '../shifts-client/src/shared/rules.js';

const { db } = await import('./fake-firestore.js');
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations.js');

let server, base;
const today = todayInIsrael();
const d = n => addDays(today, n);

function seed() {
  const put = (col, id, data) => db.col(col).set(String(id), data);
  put('Organizations', 1, { id: 1, name: 'חופ"ה' });
  put('Organizations', 2, { id: 2, name: 'אחרת' });
  // נתונים "ישנים": סיסמאות גלויות, מזהה ארגון כמחרוזת, פטורים בטבלה נפרדת
  put('Users', 1, { id: 1, full_name: 'על', password: 'root1', role: 'super_admin', is_active: 1, does_shifts: 0 });
  put('Users', 2, { id: 2, full_name: 'אחראית', password: 'admin1', role: 'admin', organization_id: '1', is_active: 1, does_shifts: 0 });
  put('Users', 3, { id: 3, full_name: 'חייל א', password: 'pass1', role: 'soldier', organization_id: 1, is_active: 1, does_shifts: 1, potential_reduction: 100, division: 'מבצעים', gender: 'male' });
  put('Users', 4, { id: 4, full_name: 'חייל ב', password: 'pass2', role: 'soldier', organization_id: 1, is_active: 1, does_shifts: 1, potential_reduction: 0, gender: 'male' });
  put('Users', 5, { id: 5, full_name: 'חייל ג', password: 'pass3', role: 'soldier', organization_id: 1, is_active: 1, does_shifts: 1, potential_reduction: 100, gender: 'female' });
  put('Users', 6, { id: 6, full_name: 'זר', password: 'pass4', role: 'admin', organization_id: 2, is_active: 1, does_shifts: 1 });
  put('User_Exemptions', 1, { id: 1, user_id: 5, exemption_type_id: 4 });
  put('Exemption_Types', 1, { id: 1, name: 'פטור מטבח' });
  put('Exemption_Types', 4, { id: 4, name: 'פטור שבתות' });
  put('Shift_Types', 1, { id: 1, organization_id: 1, name: 'שמירות', points_base: 1, color: '#27ae60' });
  put('Shift_Types', 2, { id: 2, organization_id: 1, name: 'מטבח', points_base: 1, color: '#8e44ad' });
  put('Shifts', 10, { id: 10, organization_id: 1, user_id: 3, shift_type_id: 1, start_date: d(-20), end_date: d(-18), is_published: 1 });
  put('Shift_Exemptions', 1, { id: 1, shift_id: 10, start_date: d(-19), end_date: d(-19), type: 'pet' });
  put('Shift_Exemptions', 2, { id: 2, shift_id: 999, start_date: d(1), end_date: d(1), type: 'pet' }); // יתומה
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(full_name, password) {
  const r = await call('POST', '/api/login', { body: { full_name, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

let superT, adminT, soldierT, foreignT;

before(async () => {
  seed();
  await runMigrations();
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  superT = await login('על', 'root1');
  adminT = await login('אחראית', 'admin1');
  soldierT = await login('חייל א', 'pass1');
  foreignT = await login('זר', 'pass4');
});

after(() => server.close());

test('migration hashed passwords, merged exemptions, removed orphans', () => {
  const u5 = db.col('Users').get('5');
  assert.equal(u5.password, undefined);
  assert.match(u5.password_hash, /^\$2/);
  assert.deepEqual(u5.exemptionIds, [4]);
  assert.equal(db.col('Users').get('2').organization_id, 1);
  assert.equal(db.col('User_Exemptions').size, 0);
  assert.ok(!db.col('Shift_Exemptions').has('2'));
  assert.equal(db.col('Shift_Exemptions').get('1').organization_id, 1);
});

test('login never returns secrets, wrong password rejected', async () => {
  const r = await call('POST', '/api/login', { body: { full_name: 'חייל א', password: 'pass1' } });
  assert.equal(r.data.user.password, undefined);
  assert.equal(r.data.user.password_hash, undefined);
  assert.equal((await call('POST', '/api/login', { body: { full_name: 'חייל א', password: 'nope' } })).status, 401);
});

test('requests without a token are rejected', async () => {
  assert.equal((await call('GET', '/api/users?org_id=1')).status, 401);
  assert.equal((await call('GET', '/api/squadrons-with-admin')).status, 401);
});

test('roles are enforced by the server', async () => {
  assert.equal((await call('GET', '/api/squadrons-with-admin', { token: adminT })).status, 403);
  assert.equal((await call('POST', '/api/shifts', { token: soldierT, body: { shift_type_id: 1, start_date: d(30), end_date: d(31) } })).status, 403);
  assert.equal((await call('GET', '/api/squadrons-with-admin', { token: superT })).status, 200);
});

test('soldiers get limited user data', async () => {
  const r = await call('GET', '/api/users', { token: soldierT });
  const other = r.data.find(u => u.id === 5);
  assert.equal(other.exemptionIds, undefined);
  assert.equal(other.release_date, undefined);
  const admin = await call('GET', '/api/users', { token: adminT });
  assert.deepEqual(admin.data.find(u => u.id === 5).exemptionIds, [4]);
});

test('admins cannot touch another squadron', async () => {
  // הארגון נקבע לפי המשתמש — org_id בשאילתה לא עוזר
  const r = await call('GET', '/api/users?org_id=1', { token: foreignT });
  assert.ok(r.data.every(u => u.id === 6));
  assert.equal((await call('DELETE', '/api/shifts/10', { token: foreignT })).status, 404);
  assert.equal((await call('PUT', '/api/users/3', { token: foreignT, body: { full_name: 'x' } })).status, 404);
});

test('invalid assignment returns 400 with reason', async () => {
  // חייל ג עם פטור שבתות — טווח של שבוע מלא כולל שבת
  const r = await call('POST', '/api/shifts', { token: adminT, body: { user_id: 5, shift_type_id: 1, start_date: d(40), end_date: d(46) } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /שבת/);
});

test('constraint with missing target is rejected (not squadron-wide)', async () => {
  const a = await call('POST', '/api/constraints', { token: adminT, body: { constraint_type: 'division', division: '', start_date: d(5), end_date: d(6) } });
  assert.equal(a.status, 400);
  const b = await call('POST', '/api/constraints', { token: adminT, body: { constraint_type: 'soldier', user_id: '', start_date: d(5), end_date: d(6) } });
  assert.equal(b.status, 400);
});

test('weekend flag can be turned off explicitly', async () => {
  const r = await call('POST', '/api/shifts', { token: adminT, body: { shift_type_id: 2, start_date: d(50), end_date: d(56), is_weekend: false } });
  assert.equal(r.status, 201);
  assert.equal(db.col('Shifts').get(String(r.data.id)).is_weekend, 0);
});

test('split: regular shift does not double count the split day', async () => {
  const c = await call('POST', '/api/shifts', { token: adminT, body: { user_id: 3, shift_type_id: 2, start_date: d(60), end_date: d(65) } });
  assert.equal(c.status, 201);
  const s = await call('POST', `/api/shifts/${c.data.id}/split`, { token: adminT, body: { split_date: d(63) } });
  assert.equal(s.status, 201);
  assert.equal(db.col('Shifts').get(String(c.data.id)).end_date, d(62));
  assert.equal(db.col('Shifts').get(String(s.data.new_shift_id)).start_date, d(63));
});

test('publish and unpublish use the same rule', async () => {
  const pub = await call('PUT', '/api/shifts/publish-range', { token: adminT, body: { start_date: d(50), end_date: d(70) } });
  const unpub = await call('PUT', '/api/shifts/unpublish-range', { token: adminT, body: { start_date: d(50), end_date: d(70) } });
  assert.equal(pub.data.count, unpub.data.count);
  assert.ok(pub.data.count >= 3);
});

test('soldier sees only published shifts', async () => {
  const r = await call('GET', '/api/shifts', { token: soldierT });
  assert.ok(r.data.every(s => s.is_published === 1));
});

test('auto-assign: skips potential 0, respects exemptions, only future', async () => {
  const ids = [];
  for (const [s, e] of [[d(80), d(80)], [d(90), d(90)], [d(100), d(100)]]) {
    const r = await call('POST', '/api/shifts', { token: adminT, body: { shift_type_id: 1, start_date: s, end_date: e } });
    ids.push(r.data.id);
  }
  const past = await call('POST', '/api/shifts', { token: adminT, body: { shift_type_id: 1, start_date: d(-3), end_date: d(-3) } });
  const r = await call('POST', '/api/auto-assign', { token: adminT });
  assert.equal(r.status, 200);
  for (const id of ids) {
    const uid = db.col('Shifts').get(String(id)).user_id;
    assert.ok([3, 5].includes(uid), `shift ${id} assigned to ${uid}`);
  }
  assert.equal(db.col('Shifts').get(String(past.data.id)).user_id, null);
});

test('concurrent creates never reuse an id', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    call('POST', '/api/shifts', { token: adminT, body: { shift_type_id: 1, start_date: d(200 + i), end_date: d(200 + i) } })));
  const ids = results.map(r => r.data.id);
  assert.equal(new Set(ids).size, 10);
});

test('partial user update keeps exemptions', async () => {
  const r = await call('PUT', '/api/users/5', { token: adminT, body: { full_name: 'חייל ג' } });
  assert.equal(r.status, 200);
  assert.deepEqual(db.col('Users').get('5').exemptionIds, [4]);
  const me = await call('PUT', '/api/me', { token: adminT, body: { does_shifts: 1 } });
  assert.equal(me.status, 200);
});

test('deleting a soldier keeps history name and frees future shifts', async () => {
  const fut = await call('POST', '/api/shifts', { token: adminT, body: { user_id: 3, shift_type_id: 2, start_date: d(300), end_date: d(301) } });
  const r = await call('DELETE', '/api/users/3', { token: adminT });
  assert.equal(r.status, 200);
  assert.equal(db.col('Shifts').get('10').former_user_name, 'חייל א');
  assert.equal(db.col('Shifts').get(String(fut.data.id)).user_id, null);
  const shifts = await call('GET', '/api/shifts', { token: adminT });
  assert.equal(shifts.data.find(s => s.id === 10).full_name, 'חייל א (לשעבר)');
  // הטוקן של החייל שנמחק לא עובד יותר
  assert.equal((await call('GET', '/api/me', { token: soldierT })).status, 401);
});

test('periods: overlapping rejected, valid saved', async () => {
  const bad = await call('POST', '/api/periods', { token: adminT, body: { periods: [
    { name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' },
    { name: '2.26', start_date: '2026-07-01', end_date: '2027-01-10' }
  ] } });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/periods', { token: adminT, body: { periods: [
    { name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' },
    { name: '2.26', start_date: '2026-07-11', end_date: '2027-01-10' }
  ] } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/periods/1', { token: adminT })).data.length, 2);
});

test('calendar endpoints are reachable and need auth', async () => {
  assert.equal((await call('GET', '/api/calendar/auth-url')).status, 401);
  const r = await call('GET', '/api/calendar/auth-url', { token: adminT });
  assert.equal(r.status, 503); // לא הוגדרו מפתחות גוגל בבדיקה
});

test('deleting a squadron removes all its data', async () => {
  const r = await call('DELETE', '/api/organizations/1', { token: superT });
  assert.equal(r.status, 200);
  for (const col of ['Shifts', 'Shift_Exemptions', 'Constraints', 'Periods', 'Shift_Types']) {
    assert.ok([...db.col(col).values()].every(x => x.organization_id !== 1), col);
  }
  assert.ok([...db.col('Users').values()].every(u => u.organization_id !== 1));
});
