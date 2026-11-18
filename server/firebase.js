import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  }
  return null;
}

const useMemoryDb = process.env.SHIFTS_TEST_DB === 'memory';

if (!useMemoryDb && !getApps().length) {
  const serviceAccount = loadServiceAccount();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // אמולטור מקומי לבדיקות — לא צריך מפתח
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'toranoot' });
  } else if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    throw new Error('חסר מפתח שירות של Firebase: הגדירו FIREBASE_SERVICE_ACCOUNT או serviceAccountKey.json');
  }
}

// בבדיקות אוטומטיות משתמשים ב-Firestore מדומה בזיכרון
export const db = useMemoryDb
  ? (await import('../test/fake-firestore.js')).db
  : getFirestore();
