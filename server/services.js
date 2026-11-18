import { COLLECTIONS, getAll, getByOrg, getWhere } from './db.js';

// סוגי תורנות של הטייסת + סוגים כלליים (ללא organization_id). האוסף קטן.
export async function getShiftTypesForOrg(orgId) {
  const all = await getAll(COLLECTIONS.SHIFT_TYPES);
  return all.filter(t => !t.organization_id || Number(t.organization_id) === Number(orgId));
}

export async function getExemptionTypes() {
  return getAll(COLLECTIONS.EXEMPTION_TYPES);
}

export async function getReplacementsForOrg(orgId) {
  return getByOrg(COLLECTIONS.REPLACEMENTS, orgId);
}

export async function getReplacementsForShift(shiftId) {
  return getWhere(COLLECTIONS.REPLACEMENTS, 'shift_id', Number(shiftId));
}

// כל מה שצריך כדי לבדוק זכאות / לשבץ בטייסת אחת
export async function loadOrgContext(orgId, parts = ['users', 'shifts', 'types', 'exemptionTypes', 'constraints', 'replacements', 'periods']) {
  const want = new Set(parts);
  const [users, shifts, types, exemptionTypes, constraints, replacements, periods] = await Promise.all([
    want.has('users') ? getByOrg(COLLECTIONS.USERS, orgId) : [],
    want.has('shifts') ? getByOrg(COLLECTIONS.SHIFTS, orgId) : [],
    want.has('types') ? getShiftTypesForOrg(orgId) : [],
    want.has('exemptionTypes') ? getExemptionTypes() : [],
    want.has('constraints') ? getByOrg(COLLECTIONS.CONSTRAINTS, orgId) : [],
    want.has('replacements') ? getReplacementsForOrg(orgId) : [],
    want.has('periods') ? getByOrg(COLLECTIONS.PERIODS, orgId) : []
  ]);
  return { users, shifts, types, exemptionTypes, constraints, replacements, periods };
}

export async function isNameTaken(fullName, exceptUserId = null) {
  const name = String(fullName || '').trim();
  const users = await getWhere(COLLECTIONS.USERS, 'full_name', name);
  return users.some(u => exceptUserId === null || Number(u.id) !== Number(exceptUserId));
}
