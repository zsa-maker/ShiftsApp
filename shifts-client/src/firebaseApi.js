import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where
} from 'firebase/firestore';

// 1. הדבק כאן את ה-firebaseConfig שהעתקת מה-Firebase Console:
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

// Intercept all /api/... fetch requests and route them directly to Firestore
const originalFetch = window.fetch.bind(window);

window.fetch = async (input, options = {}) => {
  const urlStr = typeof input === 'string' ? input : input.url;

  // Allow external calls (like Hebcal holidays) to pass through normally
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
        const exIds = userEx.filter(ue => Number(ue.user_id) === Number(u.id)).map(ue => Number(ue.exemption_type_id));
        return { ...u, exemptionIds: exIds, exemption_ids: exIds.join(',') };
      });
      return jsonResponse(filtered);
    }

    if (path === '/api/users' && method === 'POST') {
      const userId = await getNextId('Users');
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
        joined_date: new Date().toISOString().split('T')[0]
      });
      if (Array.isArray(body.exemptionIds) && body.exemptionIds.length > 0) {
        let nextExId = await getNextId('User_Exemptions');
        const batch = writeBatch(db);
        body.exemptionIds.forEach(exId => {
          batch.set(doc(db, 'User_Exemptions', String(nextExId)), { id: nextExId, user_id: userId, exemption_type_id: Number(exId) });
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
        batch.update(doc(db, 'Users', String(u.id)), { role: 'soldier' });
      });
      batch.update(doc(db, 'Users', String(body.newAdminId)), { role: 'admin' });
      await batch.commit();
      return jsonResponse({ message: 'האחראי עודכן בהצלחה!' });
    }

    if (path.startsWith('/api/users/') && method === 'PUT') {
      const userId = Number(path.split('/').pop());
      const finalDoesShifts = (body.does_shifts === 1 || body.does_shifts === true || body.does_shifts === "1") ? 1 : 0;
      const updateData = {
        full_name: body.full_name,
        release_date: body.release_date || null,
        potential_reduction: Number(body.potential_reduction ?? 100),
        does_shifts: finalDoesShifts
      };
      if (body.password && String(body.password).trim() !== '') {
        updateData.password = String(body.password).trim();
      }
      await setDoc(doc(db, 'Users', String(userId)), updateData, { merge: true });

      const existingEx = await getAllDocs('User_Exemptions');
      const delBatch = writeBatch(db);
      existingEx.filter(e => Number(e.user_id) === userId).forEach(e => {
        delBatch.delete(doc(db, 'User_Exemptions', String(e.id)));
      });
      await delBatch.commit();

      if (Array.isArray(body.exemptionIds) && body.exemptionIds.length > 0) {
        let nextExId = await getNextId('User_Exemptions');
        const addBatch = writeBatch(db);
        body.exemptionIds.forEach(exId => {
          addBatch.set(doc(db, 'User_Exemptions', String(nextExId)), { id: nextExId, user_id: userId, exemption_type_id: Number(exId) });
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
      shifts.filter(s => Number(s.user_id) === userId && s.start_date >= today).forEach(s => {
        batch.update(doc(db, 'Shifts', String(s.id)), { user_id: null });
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
      const newId = await getNextId('Shifts');
      const finalGroupId = body.group_id || `grp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      await setDoc(doc(db, 'Shifts', String(newId)), {
        id: newId,
        organization_id: Number(body.organization_id || 1),
        user_id: body.user_id ? Number(body.user_id) : null,
        shift_type_id: Number(body.shift_type_id),
        start_date: body.start_date,
        end_date: body.end_date,
        is_weekend: body.is_weekend ? 1 : 0,
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
        if (orgMatch && s.start_date >= body.start_date && s.end_date <= body.end_date) {
          batch.update(doc(db, 'Shifts', String(s.id)), { is_published: 1 });
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
        if (orgMatch && s.start_date >= body.start_date && s.start_date <= body.end_date) {
          batch.update(doc(db, 'Shifts', String(s.id)), { is_published: 0 });
          count++;
        }
      });
      await batch.commit();
      return jsonResponse({ message: `בוטל הפרסום ל-${count} תורנויות.` });
    }

    if (path.startsWith('/api/shifts/') && method === 'PUT') {
      const shiftId = path.split('/').pop();
      await setDoc(doc(db, 'Shifts', String(shiftId)), {
        user_id: body.user_id ? Number(body.user_id) : null,
        shift_type_id: Number(body.shift_type_id),
        start_date: body.start_date,
        end_date: body.end_date,
        is_weekend: body.is_weekend ? 1 : 0,
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
        batch.delete(doc(db, 'Shift_Exemptions', String(e.id)));
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
        start_date: body.start_date,
        end_date: body.end_date,
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
          batch.delete(doc(db, 'Shift_Exemptions', String(e.id)));
          count++;
        }
      });
      await batch.commit();
      return jsonResponse({ message: `נמחקו ${count} החלפות יתומות.` });
    }

    if (path.startsWith('/api/shift-exemptions/') && method === 'PUT') {
      const id = path.split('/').pop();
      await setDoc(doc(db, 'Shift_Exemptions', String(id)), {
        start_date: body.start_date,
        end_date: body.end_date,
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
        start_date: body.start_date,
        end_date: body.end_date,
        reason: body.reason || '',
        division: body.division || null
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
        delBatch.delete(doc(db, 'Periods', String(p.id)));
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
            start_date: p.start_date,
            end_date: p.end_date
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
      const [allUsers, allShifts, allConstraints, exemptions, shiftTypes] = await Promise.all([
        getAllDocs('Users'),
        getAllDocs('Shifts'),
        getAllDocs('Constraints'),
        getAllDocs('User_Exemptions'),
        getAllDocs('Shift_Types')
      ]);

      const users = allUsers.filter(u => Number(u.organization_id) === orgId);
      const shifts = allShifts.filter(s => Number(s.organization_id) === orgId);
      const constraints = allConstraints.filter(c => Number(c.organization_id) === orgId);

      const sortedShifts = shifts
        .filter(s => !s.user_id || s.user_id === 0 || s.user_id === "")
        .map(s => ({
          ...s,
          days: Math.round((new Date(s.end_date) - new Date(s.start_date)) / (1000 * 60 * 60 * 24)) + 1
        }))
        .sort((a, b) => b.days - a.days);

      const rotationUsers = users.filter(u =>
        Number(u.is_active) === 1 &&
        Number(u.does_shifts) === 1 &&
        u.role !== 'super_admin'
      );

      let userLoads = {};
      rotationUsers.forEach(u => {
        userLoads[u.id] = shifts
          .filter(s => Number(s.user_id) === Number(u.id))
          .reduce((sum, s) => sum + Math.round((new Date(s.end_date) - new Date(s.start_date)) / (1000 * 60 * 60 * 24)) + 1, 0);
      });

      const batch = writeBatch(db);

      for (const shift of sortedShifts) {
        const shiftStart = new Date(`${shift.start_date}T00:00:00`);
        const shiftEnd = new Date(`${shift.end_date}T23:59:59`);
        const shiftTypeObj = shiftTypes.find(t => Number(t.id) === Number(shift.shift_type_id));
        const typeName = shiftTypeObj?.name ? shiftTypeObj.name.toLowerCase() : "";
        const genderLimit = shiftTypeObj?.gender_limit || 'all';

        let availableCandidates = rotationUsers.filter(user => {
          if (genderLimit !== 'all' && user.gender && user.gender !== genderLimit) return false;

          const userExIds = exemptions
            .filter(e => Number(e.user_id) === Number(user.id))
            .map(e => Number(e.exemption_type_id));

          if (userExIds.includes(4) && Number(shift.is_weekend) === 1) return false;
          if (userExIds.includes(1) && typeName.includes('מטבח')) return false;
          if (userExIds.includes(2) && typeName.includes('שמיר')) return false;
          if (userExIds.includes(3) && typeName.includes('רס"ר')) return false;

          const hasClash = shifts.some(s => {
            if (Number(s.user_id) !== Number(user.id)) return false;
            const existStart = new Date(`${s.start_date}T00:00:00`);
            const existEnd = new Date(`${s.end_date}T23:59:59`);
            const bufferMs = 5 * 24 * 60 * 60 * 1000;
            return shiftStart.getTime() <= (existEnd.getTime() + bufferMs) &&
                   shiftEnd.getTime() >= (existStart.getTime() - bufferMs);
          });
          if (hasClash) return false;

          const hasConstraint = constraints.some(c => {
            const cStart = new Date(`${c.start_date}T00:00:00`);
            const cEnd = new Date(`${c.end_date}T23:59:59`);
            if (!(shiftStart <= cEnd && shiftEnd >= cStart)) return false;
            if (c.user_id && Number(c.user_id) === Number(user.id)) return true;
            if (c.division && c.division !== 'לא מוגדר' && c.division === user.division) return true;
            if (!c.user_id && (!c.division || c.division === 'לא מוגדר')) return true;
            return false;
          });
          if (hasConstraint) return false;

          return true;
        });

        availableCandidates.sort((a, b) => {
          const potA = (a.potential_reduction || 100) / 100;
          const potB = (b.potential_reduction || 100) / 100;
          return (userLoads[a.id] / potA) - (userLoads[b.id] / potB);
        });

        const bestUser = availableCandidates[0];
        if (bestUser) {
          batch.update(doc(db, 'Shifts', String(shift.id)), { user_id: bestUser.id });
          shift.user_id = bestUser.id;
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