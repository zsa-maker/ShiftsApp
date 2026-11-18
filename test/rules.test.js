import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, dayOfWeek, rangeContainsShabbat, checkEligibility, computeShiftPoints,
  computeUserStats, potentialOf, validatePeriods, getPeriodName, hasNearbyShift, todayInIsrael
} from '../shifts-client/src/shared/rules.js';

test('dates are timezone independent', () => {
  assert.equal(dayOfWeek('2026-11-21'), 6); // שבת
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-27', 3), '2026-03-30'); // מעבר שעון קיץ
  assert.ok(rangeContainsShabbat('2026-11-19', '2026-11-22'));
  assert.ok(!rangeContainsShabbat('2026-11-22', '2026-11-26'));
});

test('today uses Israel time', () => {
  // 23:30 UTC = 01:30 בישראל ביום שאחרי
  assert.equal(todayInIsrael(new Date('2026-11-18T23:30:00Z')), '2026-11-19');
});

const kitchen = { id: 1, name: 'מטבח', points_base: 1 };
const guard = { id: 2, name: 'שמירות', points_base: 2 };
const soldier = { id: 7, full_name: 'דנה', gender: 'female', division: 'מבצעים', exemptionIds: [], release_date: '2026-12-31' };

test('eligibility: release date allows ending on release day', () => {
  assert.ok(checkEligibility({ user: soldier, startDate: '2026-12-29', endDate: '2026-12-31', shiftType: kitchen }).ok);
  assert.ok(!checkEligibility({ user: soldier, startDate: '2026-12-30', endDate: '2027-01-01', shiftType: kitchen }).ok);
});

test('eligibility: exemptions and gender', () => {
  const u = { ...soldier, exemptionIds: [4, 1] };
  assert.ok(!checkEligibility({ user: u, startDate: '2026-11-20', endDate: '2026-11-21', shiftType: guard }).ok); // שבת
  assert.ok(!checkEligibility({ user: u, startDate: '2026-11-23', endDate: '2026-11-24', shiftType: kitchen }).ok); // מטבח
  assert.ok(checkEligibility({ user: u, startDate: '2026-11-23', endDate: '2026-11-24', shiftType: guard }).ok);
  assert.ok(!checkEligibility({ user: soldier, startDate: '2026-11-23', endDate: '2026-11-24', shiftType: { ...guard, gender_limit: 'male' } }).ok);
});

test('eligibility: constraints by soldier / division / squadron', () => {
  const base = { start_date: '2026-11-23', end_date: '2026-11-25' };
  const args = c => ({ user: soldier, startDate: '2026-11-24', endDate: '2026-11-24', shiftType: guard, constraints: [{ ...base, ...c }] });
  assert.ok(!checkEligibility(args({ constraint_type: 'soldier', user_id: 7 })).ok);
  assert.ok(checkEligibility(args({ constraint_type: 'soldier', user_id: 8 })).ok);
  assert.ok(!checkEligibility(args({ constraint_type: 'division', division: 'מבצעים' })).ok);
  assert.ok(checkEligibility(args({ constraint_type: 'division', division: 'טכני' })).ok);
  assert.ok(!checkEligibility(args({ constraint_type: 'squadron' })).ok);
});

test('points: one rule everywhere, replacements subtract days', () => {
  // שמירות 4 ימים, בסיס 2: 1 + 2 + 2 + 1
  const s = { id: 1, start_date: '2026-11-22', end_date: '2026-11-25', is_weekend: 0 };
  assert.equal(computeShiftPoints(s, guard, []), 6);
  assert.equal(computeShiftPoints(s, guard, [{ shift_id: 1, type: 'pet', start_date: '2026-11-23', end_date: '2026-11-23' }]), 4);
  // מטבח רגיל: חמישי שווה חצי
  assert.equal(computeShiftPoints({ id: 2, start_date: '2026-11-22', end_date: '2026-11-26', is_weekend: 0 }, kitchen, []), 4.5);
});

test('stats: shosh / mkutzarot', () => {
  const shifts = [
    { id: 1, user_id: 7, shift_type_id: 1, start_date: '2026-11-22', end_date: '2026-11-27', is_weekend: 0 }, // ראשון-שישי
    { id: 2, user_id: 7, shift_type_id: 2, start_date: '2026-12-03', end_date: '2026-12-06', is_weekend: 1 }
  ];
  const reps = [{ shift_id: 2, type: 'pet', start_date: '2026-12-04', end_date: '2026-12-05' }]; // שישי-שבת
  const st = computeUserStats(7, shifts, [kitchen, guard], reps);
  assert.equal(st.mkutzarot, 2); // תורנות 1 מתחילה בראשון, החלפת הפט מסתיימת בשבת
  assert.equal(st.shosh, 2);     // תורנות 1 מסתיימת בשישי, החלפת הפט מתחילה בשישי
  assert.equal(st.netShabbats, 0);
  assert.equal(st.shabbatExemptionPoints, 1);
});

test('potential 0 stays 0', () => {
  assert.equal(potentialOf({ potential_reduction: 0 }), 0);
  assert.equal(potentialOf({}), 100);
  assert.equal(potentialOf({ potential_reduction: '50' }), 50);
});

test('periods validation and lookup', () => {
  assert.match(validatePeriods([{ name: 'a', start_date: '2026-01-01', end_date: '2026-07-10' }, { name: 'b', start_date: '2026-07-01', end_date: '2026-12-31' }]), /חופפות/);
  assert.equal(validatePeriods([{ name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' }]), null);
  assert.equal(getPeriodName('2026-07-05', [{ name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' }]), '1.26');
  assert.equal(getPeriodName('2026-08-05', []), '2.26');
});

test('nearby shift buffer', () => {
  const shifts = [{ id: 1, user_id: 7, start_date: '2026-11-10', end_date: '2026-11-12' }];
  assert.ok(hasNearbyShift({ userId: 7, startDate: '2026-11-17', endDate: '2026-11-18', shifts }));
  assert.ok(!hasNearbyShift({ userId: 7, startDate: '2026-11-18', endDate: '2026-11-19', shifts }));
});
