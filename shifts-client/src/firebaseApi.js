import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    setDoc,
    deleteDoc,
    writeBatch,
    query,
    where
} from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyBrLPJMceVcNSRtOQ4PxTAZhrKbZP8dpNc",
    authDomain: "toranoot.firebaseapp.com",
    projectId: "toranoot",
    storageBucket: "toranoot.firebasestorage.app",
    messagingSenderId: "237337283825",
    appId: "1:237337283825:web:1170ba0af516ef611c6d50",
    measurementId: "G-K7HTFH43N6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function getNextId(colName) {
    const snap = await getDocs(collection(db, colName));
    let maxId = 0;
    snap.forEach(d => {
        const numId = Number(d.data().id || d.id);
        if (!isNaN(numId) && numId > maxId) maxId = numId;
    });
    return maxId + 1;
}

async function getAllDocs(colName) {
    const snap = await getDocs(collection(db, colName));
    return snap.docs.map(d => {
        const data = d.data();
        return {
            ...data,
            _docId: d.id,
            id: data.id !== undefined ? data.id : (isNaN(Number(d.id)) ? d.id : Number(d.id))
        };
    });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

// פונקציות עזר לתאריכים, שבתות ובדיקת פטורים ואילוצים
function cleanDateStr(dateStr) {
    if (!dateStr) return '';
    return String(dateStr).split('T')[0].trim();
}

function doesRangeContainShabbat(startStr, endStr) {
    const s = cleanDateStr(startStr);
    const e = cleanDateStr(endStr);
    if (!s || !e) return false;

    const current = new Date(`${s}T00:00:00`);
    const end = new Date(`${e}T23:59:59`);
    while (current <= end) {
        if (current.getDay() === 6) return true;
        current.setDate(current.getDate() + 1);
    }
    return false;
}

function checkUserEligibilityForShift({
    user,
    shiftStartStr,
    shiftEndStr,
    isWeekendFlag,
    shiftTypeObj,
    userExemptionRecords,
    exemptionTypes,
    constraints
}) {
    if (!user) return { ok: false, reason: 'חייל לא נמצא' };

    const sStartStr = cleanDateStr(shiftStartStr);
    const sEndStr = cleanDateStr(shiftEndStr);
    const shiftStart = new Date(`${sStartStr}T00:00:00`);
    const shiftEnd = new Date(`${sEndStr}T23:59:59`);

    // 1. בדיקת תאריך שחרור
    if (user.release_date) {
        const relStr = cleanDateStr(user.release_date);
        if (relStr) {
            const releaseDate = new Date(`${relStr}T23:59:59`);
            if (shiftEnd > releaseDate) {
                return { ok: false, reason: `החייל ${user.full_name} משתחרר לפני סיום התורנות (${relStr})` };
            }
        }
    }

    // 2. בדיקת מגדר מול סוג תורנות
    const genderLimit = shiftTypeObj?.gender_limit || 'all';
    if (genderLimit !== 'all' && user.gender && user.gender !== genderLimit) {
        return {
            ok: false,
            reason: `תורנות זו מוגדרת עבור ${genderLimit === 'male' ? 'בנים בלבד' : 'בנות בלבד'}`
        };
    }

    // 3. איסוף כל הפטורים של החייל (גם מ-User_Exemptions וגם משדה exemptionIds על החייל אם קיים)
    const exIdsFromTable = (userExemptionRecords || [])
        .filter(e => Number(e.user_id) === Number(user.id))
        .map(e => String(e.exemption_type_id));
    const exIdsFromUser = Array.isArray(user.exemptionIds)
        ? user.exemptionIds.map(id => String(id))
        : [];
    const allUserExIds = [...new Set([...exIdsFromTable, ...exIdsFromUser])];

    const userExNames = allUserExIds.map(id => {
        const found = (exemptionTypes || []).find(et => String(et.id) === String(id));
        return found && found.name ? found.name.toLowerCase() : '';
    });

    const hasExemption = (idNum, keyword) =>
        allUserExIds.includes(String(idNum)) ||
        userExNames.some(name => name.includes(keyword));

    // 4. בדיקת פטור שבתות (לפי דגל או לפי יום שבת בטווח התאריכים)
    const isShabbat = Number(isWeekendFlag) === 1 || isWeekendFlag === true || doesRangeContainShabbat(sStartStr, sEndStr);
    if (isShabbat && hasExemption(4, 'שבת')) {
        return { ok: false, reason: `ל-${user.full_name} יש פטור שבתות` };
    }

    // 5. בדיקת פטור לפי סוג תורנות (מטבח, שמירות, רס"ר)
    const typeName = (shiftTypeObj?.name || '').toLowerCase();
    if (typeName.includes('מטבח') && hasExemption(1, 'מטבח')) {
        return { ok: false, reason: `ל-${user.full_name} יש פטור מטבח` };
    }
    if (typeName.includes('שמיר') && hasExemption(2, 'שמיר')) {
        return { ok: false, reason: `ל-${user.full_name} יש פטור שמירות` };
    }
    if ((typeName.includes('רס"ר') || typeName.includes('רסר')) && (hasExemption(3, 'רס"ר') || hasExemption(3, 'רסר'))) {
        return { ok: false, reason: `ל-${user.full_name} יש פטור רס"ר` };
    }

    // 6. בדיקת אילוצים (חייל ספציפי, גף, או כלל הטייסת)
    const matchedConstraint = (constraints || []).find(c => {
        const cStart = new Date(`${cleanDateStr(c.start_date)}T00:00:00`);
        const cEnd = new Date(`${cleanDateStr(c.end_date)}T23:59:59`);
        if (isNaN(cStart.getTime()) || isNaN(cEnd.getTime())) return false;
        if (!(shiftStart <= cEnd && shiftEnd >= cStart)) return false;

        const cDiv = c.division ? String(c.division).trim() : '';
        const uDiv = user.division ? String(user.division).trim() : '';

        // אילוץ של חייל ספציפי
        if (c.user_id && Number(c.user_id) === Number(user.id)) return true;

        // אילוץ של גף
        if (cDiv && cDiv !== 'לא מוגדר' && uDiv && cDiv === uDiv) return true;

        // אילוץ טייסתי כללי
        if (!c.user_id && (!cDiv || cDiv === 'לא מוגדר')) return true;

        return false;
    });

    if (matchedConstraint) {
        return {
            ok: false,
            reason: `קיים אילוץ בתאריכים אלו (${matchedConstraint.reason || 'חסימת לוח'})`
        };
    }

    return { ok: true };
}

// Intercept all /api/... fetch requests and route them directly to Firestore
const originalFetch = window.fetch.bind(window);

window.fetch = async (input, options = {}) => {
    const urlStr = typeof input === 'string' ? input : input.url;

    if (!urlStr.includes('/api/')) {
        return originalFetch(input, options);
    }

    const urlObj = new URL(urlStr, window.location.origin);
    const path = urlObj.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};

    try {
        // --- LOGIN ---
        if (path === '/api/login' && method === 'POST') {
            const full_name = (body.full_name || '').trim();
            const password = String(body.password || '').trim();
            const users = await getAllDocs('Users');
            const user = users.find(u => (u.full_name || '').trim() === full_name && String(u.password).trim() === password);
            if (!user) return jsonResponse({ error: 'שם משתמש או סיסמה שגויים' }, 401);
            return jsonResponse({ user });
        }

        // --- SQUADRONS & ORGANIZATIONS ---
        if ((path === '/api/squadrons-with-admin' || path === '/api/squadrons') && method === 'GET') {
            const [orgs, users] = await Promise.all([getAllDocs('Organizations'), getAllDocs('Users')]);
            const res = orgs.map(o => {
                const admin = users.find(u => Number(u.organization_id) === Number(o.id) && u.role === 'admin');
                return { id: o.id, name: o.name, admin_name: admin ? admin.full_name : null, admin_id: admin ? admin.id : null };
            });
            return jsonResponse(res);
        }

        if (path === '/api/setup-squadron' && method === 'POST') {
            const { squadronData, adminData } = body;
            const squadronId = await getNextId('Organizations');
            await setDoc(doc(db, 'Organizations', String(squadronId)), { id: squadronId, name: squadronData.name });
            const userId = await getNextId('Users');
            await setDoc(doc(db, 'Users', String(userId)), {
                id: userId,
                full_name: adminData.full_name,
                password: String(adminData.password),
                role: 'admin',
                organization_id: squadronId,
                is_active: 1,
                does_shifts: 0,
                potential_reduction: 100,
                division: 'לא מוגדר',
                joined_date: new Date().toISOString().split('T')[0]
            });
            return jsonResponse({ squadronId }, 201);
        }

        if (path.startsWith('/api/organizations/') && method === 'DELETE') {
            const orgId = Number(path.split('/').pop());
            for (const col of ['Shifts', 'Constraints', 'Periods', 'Shift_Types', 'Users']) {
                const q = query(collection(db, col), where('organization_id', '==', orgId));
                const snap = await getDocs(q);
                const batch = writeBatch(db);
                snap.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
            await deleteDoc(doc(db, 'Organizations', String(orgId)));
            return jsonResponse({ message: 'הטייסת נמחקה' });
        }

        // --- USERS ---
        if (path === '/api/users' && method === 'GET') {
            const orgId = Number(urlObj.searchParams.get('org_id'));
            const [users, userEx] = await Promise.all([getAllDocs('Users'), getAllDocs('User_Exemptions')]);
            const filtered = users.filter(u => Number(u.organization_id) === orgId).map(u => {
                const exFromTable = userEx
                    .filter(ue => Number(ue.user_id) === Number(u.id))
                    .map(ue => Number(ue.exemption_type_id));
                const exFromUserDoc = Array.isArray(u.exemptionIds) ? u.exemptionIds.map(Number) : [];
                const exIds = [...new Set([...exFromTable, ...exFromUserDoc])];
                return { ...u, exemptionIds: exIds, exemption_ids: exIds.join(',') };
            });
            return jsonResponse(filtered);
        }

        if (path === '/api/users' && method === 'POST') {
            const userId = await getNextId('Users');
            const cleanExIds = Array.isArray(body.exemptionIds) ? body.exemptionIds.map(Number) : [];
            await setDoc(doc(db, 'Users', String(userId)), {
                id: userId,
                organization_id: Number(body.organization_id),
                full_name: body.full_name,
                password: String(body.password),
                role: body.role || 'soldier',
                does_shifts: body.does_shifts ?? 1,
                is_active: body.is_active ?? 1,
                release_date: body.release_date || null,
                potential_reduction: Number(body.potential_reduction ?? 100),
                division: body.division || 'לא מוגדר',
                gender: body.gender || 'male',
                exemptionIds: cleanExIds,
                joined_date: new Date().toISOString().split('T')[0]
            });
            if (cleanExIds.length > 0) {
                let nextExId = await getNextId('User_Exemptions');
                const batch = writeBatch(db);
                cleanExIds.forEach(exId => {
                    batch.set(doc(db, 'User_Exemptions', String(nextExId)), {
                        id: nextExId,
                        user_id: userId,
                        exemption_type_id: Number(exId)
                    });
                    nextExId++;
                });
                await batch.commit();
            }
            return jsonResponse({ id: userId, message: 'החייל נוצר בהצלחה!' });
        }

        if (path.startsWith('/api/users/update-admin/') && method === 'PUT') {
            const orgId = Number(path.split('/').pop());
            const users = await getAllDocs('Users');
            const batch = writeBatch(db);
            users.filter(u => Number(u.organization_id) === orgId && u.role === 'admin').forEach(u => {
                batch.update(doc(db, 'Users', String(u._docId || u.id)), { role: 'soldier' });
            });
            batch.update(doc(db, 'Users', String(body.newAdminId)), { role: 'admin' });
            await batch.commit();
            return jsonResponse({ message: 'האחראי עודכן בהצלחה!' });
        }

        if (path.startsWith('/api/users/') && method === 'PUT') {
            const userId = Number(path.split('/').pop());
            const finalDoesShifts = (body.does_shifts === 1 || body.does_shifts === true || body.does_shifts === "1") ? 1 : 0;
            const cleanExIds = Array.isArray(body.exemptionIds) ? body.exemptionIds.map(Number) : [];
            const updateData = {
                full_name: body.full_name,
                release_date: body.release_date || null,
                potential_reduction: Number(body.potential_reduction ?? 100),
                does_shifts: finalDoesShifts,
                exemptionIds: cleanExIds
            };
            if (body.division !== undefined) {
                updateData.division = body.division || 'לא מוגדר';
            }
            if (body.gender !== undefined) {
                updateData.gender = body.gender;
            }
            if (body.password && String(body.password).trim() !== '') {
                updateData.password = String(body.password).trim();
            }
            await setDoc(doc(db, 'Users', String(userId)), updateData, { merge: true });

            const existingEx = await getAllDocs('User_Exemptions');
            const delBatch = writeBatch(db);
            existingEx.filter(e => Number(e.user_id) === userId).forEach(e => {
                delBatch.delete(doc(db, 'User_Exemptions', String(e._docId || e.id)));
            });
            await delBatch.commit();

            if (cleanExIds.length > 0) {
                let nextExId = await getNextId('User_Exemptions');
                const addBatch = writeBatch(db);
                cleanExIds.forEach(exId => {
                    addBatch.set(doc(db, 'User_Exemptions', String(nextExId)), {
                        id: nextExId,
                        user_id: userId,
                        exemption_type_id: Number(exId)
                    });
                    nextExId++;
                });
                await addBatch.commit();
            }
            return jsonResponse({ message: 'החייל עודכן בהצלחה!' });
        }

        if (path.startsWith('/api/users/') && method === 'DELETE') {
            const userId = Number(path.split('/').pop());
            const today = new Date().toISOString().split('T')[0];
            const shifts = await getAllDocs('Shifts');
            const batch = writeBatch(db);
            shifts.filter(s => Number(s.user_id) === userId && cleanDateStr(s.start_date) >= today).forEach(s => {
                batch.update(doc(db, 'Shifts', String(s._docId || s.id)), { user_id: null });
            });
            await batch.commit();
            await deleteDoc(doc(db, 'Users', String(userId)));
            return jsonResponse({ message: 'החייל נמחק!' });
        }

        // --- SHIFT TYPES ---
        if (path === '/api/shift-types' && method === 'GET') {
            const orgId = urlObj.searchParams.get('org_id');
            const types = await getAllDocs('Shift_Types');
            const filtered = orgId ? types.filter(t => !t.organization_id || Number(t.organization_id) === Number(orgId)) : types;
            return jsonResponse(filtered);
        }

        if (path === '/api/shift-types' && method === 'POST') {
            const newId = await getNextId('Shift_Types');
            await setDoc(doc(db, 'Shift_Types', String(newId)), {
                id: newId,
                organization_id: Number(body.organization_id),
                name: body.name,
                is_weekend: body.is_weekend ? 1 : 0,
                color: body.color || '#3174ad',
                points_base: Number(body.points_base || 1.0),
                gender_limit: body.gender_limit || 'all'
            });
            return jsonResponse({ id: newId, message: 'סוג תורנות נוצר!' });
        }

        // --- SHIFTS ---
        if (path === '/api/shifts' && method === 'GET') {
            const orgId = urlObj.searchParams.get('org_id');
            const [shifts, users, types] = await Promise.all([
                getAllDocs('Shifts'),
                getAllDocs('Users'),
                getAllDocs('Shift_Types')
            ]);
            const filtered = orgId ? shifts.filter(s => Number(s.organization_id) === Number(orgId)) : shifts;
            const enriched = filtered.map(s => {
                const u = users.find(usr => Number(usr.id) === Number(s.user_id));
                const t = types.find(tp => Number(tp.id) === Number(s.shift_type_id));
                return {
                    ...s,
                    full_name: u ? u.full_name : null,
                    type_name: t ? t.name : 'תורנות',
                    type_color: t ? t.color : '#3174ad',
                    is_published: s.is_published ?? 0
                };
            });
            return jsonResponse(enriched);
        }

        if (path === '/api/shifts' && method === 'POST') {
            if (body.user_id) {
                const [allUsers, allConstraints, userEx, exTypes, shiftTypes] = await Promise.all([
                    getAllDocs('Users'),
                    getAllDocs('Constraints'),
                    getAllDocs('User_Exemptions'),
                    getAllDocs('Exemption_Types'),
                    getAllDocs('Shift_Types')
                ]);
                const user = allUsers.find(u => Number(u.id) === Number(body.user_id));
                const shiftTypeObj = shiftTypes.find(t => Number(t.id) === Number(body.shift_type_id));
                const orgConstraints = allConstraints.filter(c => Number(c.organization_id) === Number(body.organization_id || user?.organization_id));

                const check = checkUserEligibilityForShift({
                    user,
                    shiftStartStr: body.start_date,
                    shiftEndStr: body.end_date,
                    isWeekendFlag: body.is_weekend,
                    shiftTypeObj,
                    userExemptionRecords: userEx,
                    exemptionTypes: exTypes,
                    constraints: orgConstraints
                });

                if (!check.ok) {
                    return jsonResponse({ error: check.reason }, 400);
                }
            }

            const newId = await getNextId('Shifts');
            const finalGroupId = body.group_id || `grp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const isWeekend = body.is_weekend || doesRangeContainShabbat(body.start_date, body.end_date) ? 1 : 0;

            await setDoc(doc(db, 'Shifts', String(newId)), {
                id: newId,
                organization_id: Number(body.organization_id || 1),
                user_id: body.user_id ? Number(body.user_id) : null,
                shift_type_id: Number(body.shift_type_id),
                start_date: cleanDateStr(body.start_date),
                end_date: cleanDateStr(body.end_date),
                is_weekend: isWeekend,
                is_baltam: body.is_baltam ? 1 : 0,
                is_published: 0,
                group_id: finalGroupId,
                notes: body.notes || '',
                holiday_name: body.holiday_name || null
            });
            return jsonResponse({ id: newId, group_id: finalGroupId, message: 'התורנות נשמרה!' });
        }

        if (path === '/api/shifts/publish-range' && method === 'PUT') {
            const shifts = await getAllDocs('Shifts');
            const batch = writeBatch(db);
            let count = 0;
            shifts.forEach(s => {
                const orgMatch = !body.organization_id || Number(s.organization_id) === Number(body.organization_id);
                if (orgMatch && cleanDateStr(s.start_date) >= cleanDateStr(body.start_date) && cleanDateStr(s.end_date) <= cleanDateStr(body.end_date)) {
                    batch.update(doc(db, 'Shifts', String(s._docId || s.id)), { is_published: 1 });
                    count++;
                }
            });
            await batch.commit();
            return jsonResponse({ message: `הצלחה! עודכנו ${count} תורנויות.` });
        }

        if (path === '/api/shifts/unpublish-range' && method === 'PUT') {
            const shifts = await getAllDocs('Shifts');
            const batch = writeBatch(db);
            let count = 0;
            shifts.forEach(s => {
                const orgMatch = !body.organization_id || Number(s.organization_id) === Number(body.organization_id);
                if (orgMatch && cleanDateStr(s.start_date) >= cleanDateStr(body.start_date) && cleanDateStr(s.start_date) <= cleanDateStr(body.end_date)) {
                    batch.update(doc(db, 'Shifts', String(s._docId || s.id)), { is_published: 0 });
                    count++;
                }
            });
            await batch.commit();
            return jsonResponse({ message: `בוטל הפרסום ל-${count} תורנויות.` });
        }

        if (path.startsWith('/api/shifts/') && method === 'PUT') {
            const shiftId = path.split('/').pop();

            if (body.user_id) {
                const [allUsers, allConstraints, userEx, exTypes, shiftTypes] = await Promise.all([
                    getAllDocs('Users'),
                    getAllDocs('Constraints'),
                    getAllDocs('User_Exemptions'),
                    getAllDocs('Exemption_Types'),
                    getAllDocs('Shift_Types')
                ]);
                const user = allUsers.find(u => Number(u.id) === Number(body.user_id));
                const shiftTypeObj = shiftTypes.find(t => Number(t.id) === Number(body.shift_type_id));
                const orgConstraints = allConstraints.filter(c => Number(c.organization_id) === Number(body.organization_id || user?.organization_id));

                const check = checkUserEligibilityForShift({
                    user,
                    shiftStartStr: body.start_date,
                    shiftEndStr: body.end_date,
                    isWeekendFlag: body.is_weekend,
                    shiftTypeObj,
                    userExemptionRecords: userEx,
                    exemptionTypes: exTypes,
                    constraints: orgConstraints
                });

                if (!check.ok) {
                    return jsonResponse({ error: check.reason }, 400);
                }
            }

            const isWeekend = body.is_weekend || doesRangeContainShabbat(body.start_date, body.end_date) ? 1 : 0;

            await setDoc(doc(db, 'Shifts', String(shiftId)), {
                user_id: body.user_id ? Number(body.user_id) : null,
                shift_type_id: Number(body.shift_type_id),
                start_date: cleanDateStr(body.start_date),
                end_date: cleanDateStr(body.end_date),
                is_weekend: isWeekend,
                is_baltam: body.is_baltam ? 1 : 0,
                notes: body.notes || ''
            }, { merge: true });
            return jsonResponse({ message: 'התורנות עודכנה!' });
        }

        if (path.startsWith('/api/shifts/') && method === 'DELETE') {
            const shiftId = Number(path.split('/').pop());
            const exemptions = await getAllDocs('Shift_Exemptions');
            const batch = writeBatch(db);
            exemptions.filter(e => Number(e.shift_id) === shiftId).forEach(e => {
                batch.delete(doc(db, 'Shift_Exemptions', String(e._docId || e.id)));
            });
            batch.delete(doc(db, 'Shifts', String(shiftId)));
            await batch.commit();
            return jsonResponse({ message: 'התורנות נמחקה!' });
        }

        // --- EXEMPTION TYPES & SHIFT EXEMPTIONS ---
        if (path === '/api/exemption-types' && method === 'GET') {
            return jsonResponse(await getAllDocs('Exemption_Types'));
        }

        if (path === '/api/shift-exemptions' && method === 'GET') {
            return jsonResponse(await getAllDocs('Shift_Exemptions'));
        }

        if (path === '/api/shift-exemptions' && method === 'POST') {
            const newId = await getNextId('Shift_Exemptions');
            await setDoc(doc(db, 'Shift_Exemptions', String(newId)), {
                id: newId,
                shift_id: Number(body.shift_id),
                start_date: cleanDateStr(body.start_date),
                end_date: cleanDateStr(body.end_date),
                type: body.type || 'pet',
                start_time: body.start_time || null,
                end_time: body.end_time || null
            });
            return jsonResponse({ id: newId });
        }

        if (path === '/api/shift-exemptions/cleanup' && method === 'DELETE') {
            const [exemptions, shifts] = await Promise.all([getAllDocs('Shift_Exemptions'), getAllDocs('Shifts')]);
            const validIds = new Set(shifts.map(s => Number(s.id)));
            const batch = writeBatch(db);
            let count = 0;
            exemptions.forEach(e => {
                if (!validIds.has(Number(e.shift_id))) {
                    batch.delete(doc(db, 'Shift_Exemptions', String(e._docId || e.id)));
                    count++;
                }
            });
            await batch.commit();
            return jsonResponse({ message: `נמחקו ${count} החלפות יתומות.` });
        }

        if (path.startsWith('/api/shift-exemptions/') && method === 'PUT') {
            const id = path.split('/').pop();
            await setDoc(doc(db, 'Shift_Exemptions', String(id)), {
                start_date: cleanDateStr(body.start_date),
                end_date: cleanDateStr(body.end_date),
                type: body.type,
                start_time: body.start_time || null,
                end_time: body.end_time || null
            }, { merge: true });
            return jsonResponse({ message: 'Success' });
        }

        if (path.startsWith('/api/shift-exemptions/') && method === 'DELETE') {
            const id = path.split('/').pop();
            await deleteDoc(doc(db, 'Shift_Exemptions', String(id)));
            return jsonResponse({ message: 'נמחק בהצלחה' });
        }

        // --- CONSTRAINTS ---
        if (path === '/api/constraints' && method === 'GET') {
            const orgId = urlObj.searchParams.get('org_id');
            const [constraints, users] = await Promise.all([getAllDocs('Constraints'), getAllDocs('Users')]);
            const filtered = orgId ? constraints.filter(c => Number(c.organization_id) === Number(orgId)) : constraints;
            const enriched = filtered.map(c => {
                const u = users.find(usr => Number(usr.id) === Number(c.user_id));
                return { ...c, full_name: u ? u.full_name : null };
            });
            return jsonResponse(enriched);
        }

        if (path === '/api/constraints' && method === 'POST') {
            const newId = await getNextId('Constraints');
            await setDoc(doc(db, 'Constraints', String(newId)), {
                id: newId,
                organization_id: Number(body.organization_id || 1),
                user_id: body.user_id ? Number(body.user_id) : null,
                start_date: cleanDateStr(body.start_date),
                end_date: cleanDateStr(body.end_date),
                reason: body.reason || '',
                division: body.division ? String(body.division).trim() : null,
                constraint_type: body.constraint_type || (body.user_id ? 'soldier' : (body.division ? 'division' : 'squadron'))
            });
            return jsonResponse({ id: newId, message: 'האילוץ נוצר!' });
        }

        if (path.startsWith('/api/constraints/') && method === 'DELETE') {
            const id = path.split('/').pop();
            await deleteDoc(doc(db, 'Constraints', String(id)));
            return jsonResponse({ message: 'האילוץ נמחק!' });
        }

        // --- PERIODS ---
        if (path.startsWith('/api/periods/') && method === 'GET') {
            const orgId = Number(path.split('/').pop());
            const periods = await getAllDocs('Periods');
            const orgPeriods = periods.filter(p => Number(p.organization_id) === orgId);
            if (orgPeriods.length === 0) {
                return jsonResponse([
                    { name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' },
                    { name: '2.26', start_date: '2026-07-11', end_date: '2027-01-10' }
                ]);
            }
            return jsonResponse(orgPeriods);
        }

        if (path === '/api/periods' && method === 'POST') {
            const orgId = Number(body.organization_id);
            const existing = await getAllDocs('Periods');
            const delBatch = writeBatch(db);
            existing.filter(p => Number(p.organization_id) === orgId).forEach(p => {
                delBatch.delete(doc(db, 'Periods', String(p._docId || p.id)));
            });
            await delBatch.commit();

            if (Array.isArray(body.periods)) {
                let nextId = await getNextId('Periods');
                const addBatch = writeBatch(db);
                body.periods.forEach(p => {
                    addBatch.set(doc(db, 'Periods', String(nextId)), {
                        id: nextId,
                        organization_id: orgId,
                        name: p.name,
                        start_date: cleanDateStr(p.start_date),
                        end_date: cleanDateStr(p.end_date)
                    });
                    nextId++;
                });
                await addBatch.commit();
            }
            return jsonResponse({ message: 'התקופות נשמרו בהצלחה!' });
        }

        // --- AUTO-ASSIGN ---
        if (path === '/api/auto-assign' && method === 'POST') {
            const orgId = Number(body.org_id);
            const [allUsers, allShifts, allConstraints, exemptions, exTypes, shiftTypes] = await Promise.all([
                getAllDocs('Users'),
                getAllDocs('Shifts'),
                getAllDocs('Constraints'),
                getAllDocs('User_Exemptions'),
                getAllDocs('Exemption_Types'),
                getAllDocs('Shift_Types')
            ]);

            const users = allUsers.filter(u => Number(u.organization_id) === orgId);
            const shifts = allShifts.filter(s => Number(s.organization_id) === orgId);
            const constraints = allConstraints.filter(c => Number(c.organization_id) === orgId);

            // שומרים הפניה לאובייקטים המקוריים בתוך shifts כדי ששיבוץ יתעדכן מיד לבדיקת hasClash
            const unassignedShifts = shifts.filter(s => !s.user_id || Number(s.user_id) === 0 || s.user_id === "");
            unassignedShifts.forEach(s => {
                const sStart = new Date(`${cleanDateStr(s.start_date)}T00:00:00`);
                const sEnd = new Date(`${cleanDateStr(s.end_date)}T00:00:00`);
                s.days = Math.max(1, Math.round((sEnd - sStart) / (1000 * 60 * 60 * 24)) + 1);
            });
            unassignedShifts.sort((a, b) => b.days - a.days);

            const rotationUsers = users.filter(u =>
                Number(u.is_active) === 1 &&
                Number(u.does_shifts) === 1 &&
                u.role !== 'super_admin'
            );

            const userLoads = {};
            rotationUsers.forEach(u => {
                userLoads[u.id] = shifts
                    .filter(s => Number(s.user_id) === Number(u.id))
                    .reduce((sum, s) => {
                        const sStart = new Date(`${cleanDateStr(s.start_date)}T00:00:00`);
                        const sEnd = new Date(`${cleanDateStr(s.end_date)}T00:00:00`);
                        return sum + Math.max(1, Math.round((sEnd - sStart) / (1000 * 60 * 60 * 24)) + 1);
                    }, 0);
            });

            const batch = writeBatch(db);

            for (const shift of unassignedShifts) {
                const sStartStr = cleanDateStr(shift.start_date);
                const sEndStr = cleanDateStr(shift.end_date);
                const shiftStart = new Date(`${sStartStr}T00:00:00`);
                const shiftEnd = new Date(`${sEndStr}T23:59:59`);
                const shiftTypeObj = shiftTypes.find(t => Number(t.id) === Number(shift.shift_type_id));

                const availableCandidates = rotationUsers.filter(user => {
                    // 1. בדיקת פטורים, אילוצים, מגדר ותאריך שחרור
                    const eligibility = checkUserEligibilityForShift({
                        user,
                        shiftStartStr: sStartStr,
                        shiftEndStr: sEndStr,
                        isWeekendFlag: shift.is_weekend,
                        shiftTypeObj,
                        userExemptionRecords: exemptions,
                        exemptionTypes: exTypes,
                        constraints
                    });
                    if (!eligibility.ok) return false;

                    // 2. בדיקת מרווח מינימלי מתורנויות אחרות (כולל אלו ששובצו הרגע בלולאה!)
                    const hasClash = shifts.some(s => {
                        if (Number(s.user_id) !== Number(user.id)) return false;
                        const existStart = new Date(`${cleanDateStr(s.start_date)}T00:00:00`);
                        const existEnd = new Date(`${cleanDateStr(s.end_date)}T23:59:59`);
                        const bufferMs = 5 * 24 * 60 * 60 * 1000;
                        return shiftStart.getTime() <= (existEnd.getTime() + bufferMs) &&
                            shiftEnd.getTime() >= (existStart.getTime() - bufferMs);
                    });
                    if (hasClash) return false;

                    return true;
                });

                availableCandidates.sort((a, b) => {
                    const potA = (Number(a.potential_reduction) || 100) / 100;
                    const potB = (Number(b.potential_reduction) || 100) / 100;
                    return (userLoads[a.id] / potA) - (userLoads[b.id] / potB);
                });

                const bestUser = availableCandidates[0];
                if (bestUser) {
                    batch.update(doc(db, 'Shifts', String(shift._docId || shift.id)), { user_id: bestUser.id });
                    shift.user_id = bestUser.id; // מעדכן את האובייקט בתוך shifts כך שהאיטרציה הבאה תזהה אותו ב-hasClash
                    userLoads[bestUser.id] += shift.days;
                }
            }

            await batch.commit();
            return jsonResponse({ success: true, message: 'השיבוץ הושלם!' });
        }

        return jsonResponse({ error: 'Route not found: ' + path }, 404);
    } catch (error) {
        console.error('Firebase API Error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
};