require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// אתחול Firebase Admin מתוך קובץ המפתח או משתנה סביבה (עבור שרת ענן)
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(cors());
app.use(express.json());

// פונקציית עזר ליצירת ID מספרי רץ (כדי לשמור על תאימות מלאה ל-App.jsx)
async function getNextId(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  let maxId = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    const numId = Number(data.id || doc.id);
    if (!isNaN(numId) && numId > maxId) maxId = numId;
  });
  return maxId + 1;
}

// פונקציית עזר לשליפת כל המסמכים מקולקשן כמערך
async function getAllDocs(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      id: data.id !== undefined ? data.id : (isNaN(Number(doc.id)) ? doc.id : Number(doc.id))
    };
  });
}

// הדפסת מנהלים לטרמינל בעליית השרת
(async () => {
  try {
    const users = await getAllDocs('Users');
    const admins = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
    console.log("🔑 === רשימת מנהלים ב-Firebase Firestore ===");
    console.table(admins.map(a => ({
      id: a.id,
      full_name: a.full_name,
      password: a.password,
      role: a.role,
      organization_id: a.organization_id
    })));
  } catch (err) {
    console.error("שגיאה בשליפת מנהלים מ-Firestore:", err.message);
  }
})();

// הגדרת חיבור ליומן גוגל
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

app.get('/api/calendar/auth-url', (req, res) => {
  const userId = req.query.userId;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: userId
  });
  res.json({ url });
});

app.get('/api/calendar/auth/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) {
      await db.collection('Users').doc(String(userId)).set(
        { google_refresh_token: tokens.refresh_token },
        { merge: true }
      );
    }
    res.send(`
      <div style="text-align: center; margin-top: 50px; font-family: sans-serif; direction: rtl;">
        <h1 style="color: #28593C;">היומן קושר בהצלחה! 🎉</h1>
        <h3>אפשר לסגור את החלון הזה ולחזור למערכת.</h3>
      </div>
    `);
  } catch (error) {
    console.error("שגיאה בקבלת הטוקנים:", error);
    res.status(500).send("שגיאה בחיבור ליומן. אנא נסה שוב.");
  }
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'השרת מחובר ל-Firebase Firestore בהצלחה 🚀' });
});

// ==========================================
// ארגונים וטייסות (Organizations)
// ==========================================

app.post('/api/organizations', async (req, res) => {
  try {
    const { name } = req.body;
    const newId = await getNextId('Organizations');
    await db.collection('Organizations').doc(String(newId)).set({ id: newId, name });
    res.json({ id: newId, name, message: 'היחידה נוצרה בהצלחה! 🎉' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/squadrons-with-admin', async (req, res) => {
  try {
    const orgs = await getAllDocs('Organizations');
    const users = await getAllDocs('Users');
    const result = orgs.map(o => {
      const adminUser = users.find(u => Number(u.organization_id) === Number(o.id) && u.role === 'admin');
      return {
        id: o.id,
        name: o.name,
        admin_name: adminUser ? adminUser.full_name : null,
        admin_id: adminUser ? adminUser.id : null
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/squadrons', async (req, res) => {
  try {
    const orgs = await getAllDocs('Organizations');
    const users = await getAllDocs('Users');
    const result = orgs.map(o => {
      const adminUser = users.find(u => Number(u.organization_id) === Number(o.id) && u.role === 'admin');
      return {
        id: o.id,
        name: o.name,
        admin_name: adminUser ? adminUser.full_name : null,
        admin_id: adminUser ? adminUser.id : null
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/organizations', async (req, res) => {
  try {
    const rows = await getAllDocs('Organizations');
    res.json({ organizations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup-squadron', async (req, res) => {
  try {
    const { squadronData, adminData } = req.body;
    const squadronId = await getNextId('Organizations');
    await db.collection('Organizations').doc(String(squadronId)).set({
      id: squadronId,
      name: squadronData.name
    });

    const userId = await getNextId('Users');
    await db.collection('Users').doc(String(userId)).set({
      id: userId,
      full_name: adminData.full_name,
      password: adminData.password,
      role: 'admin',
      organization_id: squadronId,
      is_active: 1,
      does_shifts: 0,
      potential_reduction: 100,
      division: 'לא מוגדר',
      joined_date: new Date().toISOString().split('T')[0]
    });

    res.status(201).json({ squadronId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/organizations/:id', async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const collectionsToClean = ['Shifts', 'Constraints', 'Periods', 'Shift_Types', 'Users'];

    for (const col of collectionsToClean) {
      const snap = await db.collection(col).where('organization_id', '==', orgId).get();
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    await db.collection('Organizations').doc(String(orgId)).delete();
    res.json({ message: 'הטייסת וכל נתוניה נמחקו בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// משתמשים (Users & User_Exemptions)
// ==========================================

app.post('/api/users', async (req, res) => {
  try {
    const {
      organization_id, full_name, password, role,
      does_shifts, is_active, release_date,
      potential_reduction, exemptionIds, division, gender
    } = req.body;

    const userId = await getNextId('Users');
    await db.collection('Users').doc(String(userId)).set({
      id: userId,
      organization_id: Number(organization_id),
      full_name,
      password: String(password),
      role: role || 'soldier',
      does_shifts: does_shifts ?? 1,
      is_active: is_active ?? 1,
      release_date: release_date || null,
      potential_reduction: Number(potential_reduction ?? 100),
      division: division || 'לא מוגדר',
      gender: gender || 'male',
      joined_date: new Date().toISOString().split('T')[0]
    });

    if (exemptionIds && Array.isArray(exemptionIds) && exemptionIds.length > 0) {
      let nextExId = await getNextId('User_Exemptions');
      const batch = db.batch();
      exemptionIds.forEach(exemptionId => {
        const ref = db.collection('User_Exemptions').doc(String(nextExId));
        batch.set(ref, { id: nextExId, user_id: userId, exemption_type_id: Number(exemptionId) });
        nextExId++;
      });
      await batch.commit();
    }

    res.json({ id: userId, message: 'החייל נוצר בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const orgId = Number(req.query.org_id);
    if (!orgId) return res.status(400).json({ error: "חסר מזהה טייסת" });

    const allUsers = await getAllDocs('Users');
    const allUserExemptions = await getAllDocs('User_Exemptions');

    const orgUsers = allUsers
      .filter(u => Number(u.organization_id) === orgId)
      .map(u => {
        const userEx = allUserExemptions
          .filter(ue => Number(ue.user_id) === Number(u.id))
          .map(ue => Number(ue.exemption_type_id));
        return {
          ...u,
          exemption_ids: userEx.join(','),
          exemptionIds: userEx
        };
      });

    res.json(orgUsers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/update-admin/:orgId', async (req, res) => {
  try {
    const orgId = Number(req.params.orgId);
    const { newAdminId } = req.body;

    const users = await getAllDocs('Users');
    const batch = db.batch();

    users.filter(u => Number(u.organization_id) === orgId && u.role === 'admin').forEach(u => {
      batch.update(db.collection('Users').doc(String(u.id)), { role: 'soldier' });
    });

    batch.update(db.collection('Users').doc(String(newAdminId)), { role: 'admin' });
    await batch.commit();

    res.json({ message: 'האחראי עודכן בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { full_name, password, release_date, potential_reduction, exemptionIds, does_shifts } = req.body;
    const finalDoesShifts = (does_shifts === 1 || does_shifts === true || does_shifts === "1") ? 1 : 0;

    const updateData = {
      full_name,
      release_date: release_date || null,
      potential_reduction: Number(potential_reduction ?? 100),
      does_shifts: finalDoesShifts
    };

    if (password && String(password).trim() !== '') {
      updateData.password = String(password).trim();
    }

    await db.collection('Users').doc(String(userId)).set(updateData, { merge: true });

    // עדכון פטורים
    const existingEx = await getAllDocs('User_Exemptions');
    const delBatch = db.batch();
    existingEx.filter(e => Number(e.user_id) === userId).forEach(e => {
      delBatch.delete(db.collection('User_Exemptions').doc(String(e.id)));
    });
    await delBatch.commit();

    if (exemptionIds && Array.isArray(exemptionIds) && exemptionIds.length > 0) {
      let nextExId = await getNextId('User_Exemptions');
      const addBatch = db.batch();
      exemptionIds.forEach(exId => {
        const ref = db.collection('User_Exemptions').doc(String(nextExId));
        addBatch.set(ref, { id: nextExId, user_id: userId, exemption_type_id: Number(exId) });
        nextExId++;
      });
      await addBatch.commit();
    }

    res.json({ message: 'החייל והפטורים עודכנו בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const today = new Date().toISOString().split('T')[0];

    const shifts = await getAllDocs('Shifts');
    const shiftBatch = db.batch();
    shifts.filter(s => Number(s.user_id) === userId && s.start_date >= today).forEach(s => {
      shiftBatch.update(db.collection('Shifts').doc(String(s.id)), { user_id: null });
    });
    await shiftBatch.commit();

    const existingEx = await getAllDocs('User_Exemptions');
    const exBatch = db.batch();
    existingEx.filter(e => Number(e.user_id) === userId).forEach(e => {
      exBatch.delete(db.collection('User_Exemptions').doc(String(e.id)));
    });
    await exBatch.commit();

    await db.collection('Users').doc(String(userId)).delete();
    res.json({ message: 'החייל נמחק, ותורנויות עתידיות שוחררו!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const full_name = req.body.full_name ? req.body.full_name.trim() : '';
    const password = req.body.password ? String(req.body.password).trim() : '';

    const users = await getAllDocs('Users');
    const matchingUsers = users.filter(u => (u.full_name || '').trim() === full_name);

    if (matchingUsers.length === 0) {
      return res.status(401).json({ error: "שם משתמש או סיסמה שגויים" });
    }

    const authenticatedUser = matchingUsers.find(u => String(u.password).trim() === password);
    if (authenticatedUser) {
      res.json({ user: authenticatedUser });
    } else {
      res.status(401).json({ error: "שם משתמש או סיסמה שגויים" });
    }
  } catch (err) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// ==========================================
// תורנויות וסוגי תורנויות (Shifts & Shift_Types)
// ==========================================

app.post('/api/shift-types', async (req, res) => {
  try {
    const { organization_id, name, is_weekend, color, points_base, gender_limit } = req.body;
    if (!name) return res.status(400).json({ error: "חובה להזין שם תורנות" });

    const newId = await getNextId('Shift_Types');
    await db.collection('Shift_Types').doc(String(newId)).set({
      id: newId,
      organization_id: Number(organization_id),
      name,
      is_weekend: is_weekend ? 1 : 0,
      color: color || '#3174ad',
      points_base: Number(points_base || 1.0),
      gender_limit: gender_limit || 'all'
    });
    res.json({ id: newId, message: 'סוג תורנות נוצר!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shift-types', async (req, res) => {
  try {
    const orgId = req.query.org_id ? Number(req.query.org_id) : null;
    const rows = await getAllDocs('Shift_Types');
    const filtered = orgId ? rows.filter(r => !r.organization_id || Number(r.organization_id) === orgId) : rows;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shifts', async (req, res) => {
  try {
    const {
      organization_id, user_id, shift_type_id, start_date, end_date,
      is_weekend, is_baltam, group_id, notes, holiday_name
    } = req.body;

    const finalGroupId = group_id || `grp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newId = await getNextId('Shifts');

    await db.collection('Shifts').doc(String(newId)).set({
      id: newId,
      organization_id: Number(organization_id || 1),
      user_id: user_id ? Number(user_id) : null,
      shift_type_id: Number(shift_type_id),
      start_date,
      end_date,
      is_weekend: is_weekend ? 1 : 0,
      is_baltam: is_baltam ? 1 : 0,
      is_published: 0,
      group_id: finalGroupId,
      notes: notes || '',
      holiday_name: holiday_name || null
    });

    res.json({ id: newId, group_id: finalGroupId, message: 'התורנות נשמרה בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shifts', async (req, res) => {
  try {
    const orgId = req.query.org_id ? Number(req.query.org_id) : null;
    const [shifts, users, shiftTypes] = await Promise.all([
      getAllDocs('Shifts'),
      getAllDocs('Users'),
      getAllDocs('Shift_Types')
    ]);

    const filtered = orgId ? shifts.filter(s => Number(s.organization_id) === orgId) : shifts;

    const enriched = filtered.map(s => {
      const u = users.find(user => Number(user.id) === Number(s.user_id));
      const st = shiftTypes.find(t => Number(t.id) === Number(s.shift_type_id));
      return {
        ...s,
        full_name: u ? u.full_name : null,
        type_name: st ? st.name : 'תורנות',
        type_color: st ? st.color : '#3174ad',
        is_published: s.is_published ?? 0
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shifts/publish-range', async (req, res) => {
  try {
    const { start_date, end_date, organization_id } = req.body;
    const shifts = await getAllDocs('Shifts');
    const batch = db.batch();
    let count = 0;

    shifts.forEach(s => {
      const orgMatch = !organization_id || Number(s.organization_id) === Number(organization_id);
      if (orgMatch && s.start_date >= start_date && s.end_date <= end_date) {
        batch.update(db.collection('Shifts').doc(String(s.id)), { is_published: 1 });
        count++;
      }
    });

    await batch.commit();
    res.json({ message: `הצלחה! עודכנו ${count} תורנויות.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shifts/unpublish-range', async (req, res) => {
  try {
    const { start_date, end_date, organization_id } = req.body;
    const shifts = await getAllDocs('Shifts');
    const batch = db.batch();
    let count = 0;

    shifts.forEach(s => {
      const orgMatch = !organization_id || Number(s.organization_id) === Number(organization_id);
      if (orgMatch && s.start_date >= start_date && s.start_date <= end_date) {
        batch.update(db.collection('Shifts').doc(String(s.id)), { is_published: 0 });
        count++;
      }
    });

    await batch.commit();
    res.json({ message: `בוטל הפרסום ל-${count} תורנויות.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shifts/:id', async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { user_id, shift_type_id, start_date, end_date, is_weekend, is_baltam, notes } = req.body;

    await db.collection('Shifts').doc(String(shiftId)).set({
      user_id: user_id ? Number(user_id) : null,
      shift_type_id: Number(shift_type_id),
      start_date,
      end_date,
      is_weekend: is_weekend ? 1 : 0,
      is_baltam: is_baltam ? 1 : 0,
      notes: notes || ''
    }, { merge: true });

    res.json({ message: 'התורנות עודכנה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shifts/:id', async (req, res) => {
  try {
    const shiftId = Number(req.params.id);
    const exemptions = await getAllDocs('Shift_Exemptions');
    const batch = db.batch();

    exemptions.filter(e => Number(e.shift_id) === shiftId).forEach(e => {
      batch.delete(db.collection('Shift_Exemptions').doc(String(e.id)));
    });
    batch.delete(db.collection('Shifts').doc(String(shiftId)));

    await batch.commit();
    res.json({ message: 'התורנות וההחלפות שלה נמחקו בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// פטורים, החלפות ואילוצים
// ==========================================

app.get('/api/exemption-types', async (req, res) => {
  try {
    const rows = await getAllDocs('Exemption_Types');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/constraints', async (req, res) => {
  try {
    const orgId = req.query.org_id ? Number(req.query.org_id) : null;
    const [constraints, users] = await Promise.all([
      getAllDocs('Constraints'),
      getAllDocs('Users')
    ]);

    const filtered = orgId ? constraints.filter(c => Number(c.organization_id) === orgId) : constraints;
    const enriched = filtered.map(c => {
      const u = users.find(user => Number(user.id) === Number(c.user_id));
      return { ...c, full_name: u ? u.full_name : null };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/constraints', async (req, res) => {
  try {
    const { organization_id, user_id, start_date, end_date, reason, division } = req.body;
    const newId = await getNextId('Constraints');

    await db.collection('Constraints').doc(String(newId)).set({
      id: newId,
      organization_id: Number(organization_id || 1),
      user_id: user_id ? Number(user_id) : null,
      start_date,
      end_date,
      reason: reason || '',
      division: division || null
    });

    res.json({ id: newId, message: 'האילוץ נוצר בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/constraints/:id', async (req, res) => {
  try {
    await db.collection('Constraints').doc(String(req.params.id)).delete();
    res.json({ message: 'האילוץ נמחק!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/divisions/:orgId', async (req, res) => {
  try {
    const orgId = Number(req.params.orgId);
    const users = await getAllDocs('Users');
    const divisions = [...new Set(
      users
        .filter(u => Number(u.organization_id) === orgId && u.division && u.division !== 'לא מוגדר')
        .map(u => u.division)
    )];
    res.json(divisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shift-exemptions', async (req, res) => {
  try {
    const rows = await getAllDocs('Shift_Exemptions');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shift-exemptions', async (req, res) => {
  try {
    const { shift_id, start_date, end_date, type, start_time, end_time } = req.body;
    const newId = await getNextId('Shift_Exemptions');

    await db.collection('Shift_Exemptions').doc(String(newId)).set({
      id: newId,
      shift_id: Number(shift_id),
      start_date,
      end_date,
      type: type || 'pet',
      start_time: start_time || null,
      end_time: end_time || null
    });

    res.json({ id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shift-exemptions/:id', async (req, res) => {
  try {
    const { start_date, end_date, type, start_time, end_time } = req.body;
    await db.collection('Shift_Exemptions').doc(String(req.params.id)).set({
      start_date,
      end_date,
      type,
      start_time: start_time || null,
      end_time: end_time || null
    }, { merge: true });
    res.json({ message: 'Success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shift-exemptions/cleanup', async (req, res) => {
  try {
    const [exemptions, shifts] = await Promise.all([
      getAllDocs('Shift_Exemptions'),
      getAllDocs('Shifts')
    ]);
    const validShiftIds = new Set(shifts.map(s => Number(s.id)));
    const batch = db.batch();
    let count = 0;

    exemptions.forEach(e => {
      if (!validShiftIds.has(Number(e.shift_id))) {
        batch.delete(db.collection('Shift_Exemptions').doc(String(e.id)));
        count++;
      }
    });

    await batch.commit();
    res.json({ message: `בוצע! נמחקו ${count} החלפות יתומות.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shift-exemptions/:id', async (req, res) => {
  try {
    await db.collection('Shift_Exemptions').doc(String(req.params.id)).delete();
    res.json({ message: "נמחק בהצלחה" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// תקופות ושיבוץ אוטומטי
// ==========================================

app.get('/api/periods/:orgId', async (req, res) => {
  try {
    const orgId = Number(req.params.orgId);
    const periods = await getAllDocs('Periods');
    const orgPeriods = periods.filter(p => Number(p.organization_id) === orgId);

    if (orgPeriods.length === 0) {
      return res.json([
        { name: '1.26', start_date: '2026-01-01', end_date: '2026-07-10' },
        { name: '2.26', start_date: '2026-07-11', end_date: '2027-01-10' }
      ]);
    }
    res.json(orgPeriods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/periods', async (req, res) => {
  try {
    const { organization_id, periods } = req.body;
    const orgId = Number(organization_id);

    const existing = await getAllDocs('Periods');
    const delBatch = db.batch();
    existing.filter(p => Number(p.organization_id) === orgId).forEach(p => {
      delBatch.delete(db.collection('Periods').doc(String(p.id)));
    });
    await delBatch.commit();

    if (periods && Array.isArray(periods)) {
      let nextId = await getNextId('Periods');
      const addBatch = db.batch();
      periods.forEach(p => {
        const ref = db.collection('Periods').doc(String(nextId));
        addBatch.set(ref, {
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

    res.json({ message: 'התקופות נשמרו בהצלחה!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auto-assign', async (req, res) => {
  try {
    const orgId = Number(req.body.org_id);
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

    const batch = db.batch();

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
        batch.update(db.collection('Shifts').doc(String(shift.id)), { user_id: bestUser.id });
        shift.user_id = bestUser.id;
        userLoads[bestUser.id] += shift.days;
      }
    }

    await batch.commit();
    res.json({ success: true, message: "השיבוץ הושלם!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// הגשת ה-Frontend הבנוי
const distPath = path.join(__dirname, 'shifts-client', 'dist');
app.use(express.static(distPath));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server (Firebase Firestore) is running on http://localhost:${PORT}`);
});