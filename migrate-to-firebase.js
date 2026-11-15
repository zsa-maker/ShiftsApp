const sqlite3 = require('sqlite3').verbose();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

// אתחול החיבור ל-Firebase בשיטה המודולרית החדשה (תואם Node 22)
initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
const sqldb = new sqlite3.Database('./shifts.db');

const tables = [
  'Organizations',
  'Users',
  'Shift_Types',
  'Shifts',
  'Exemption_Types',
  'User_Exemptions',
  'Constraints',
  'Shift_Exemptions',
  'Periods'
];

async function migrateTable(tableName) {
  return new Promise((resolve) => {
    sqldb.all(`SELECT * FROM ${tableName}`, [], async (err, rows) => {
      if (err) {
        console.log(`⚠️ דילוג על טבלה ${tableName} (אינה קיימת):`, err.message);
        return resolve();
      }
      if (!rows || rows.length === 0) {
        console.log(`ℹ️ טבלה ${tableName} ריקה, ממשיך...`);
        return resolve();
      }

      console.log(`📦 מעביר ${rows.length} רשומות מתוך ${tableName}...`);
      const batch = firestore.batch();
      rows.forEach((row) => {
        const docId = row.id ? String(row.id) : firestore.collection(tableName).doc().id;
        const docRef = firestore.collection(tableName).doc(docId);
        batch.set(docRef, row);
      });
      await batch.commit();
      console.log(`✅ ${tableName} הועברה בהצלחה!`);
      resolve();
    });
  });
}

(async () => {
  try {
    for (const t of tables) {
      await migrateTable(t);
    }
    console.log("\n🎉 כל מסד הנתונים הועבר ל-Firebase Firestore בהצלחה!");
    process.exit(0);
  } catch (err) {
    console.error("❌ שגיאה בהעברת הנתונים:", err);
    process.exit(1);
  }
})();