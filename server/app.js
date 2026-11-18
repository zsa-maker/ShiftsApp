import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { HttpError } from './db.js';
import authRoutes from './routes/auth.js';
import organizationRoutes from './routes/organizations.js';
import userRoutes from './routes/users.js';
import shiftRoutes from './routes/shifts.js';
import replacementRoutes from './routes/replacements.js';
import constraintRoutes from './routes/constraints.js';
import periodRoutes from './routes/periods.js';
import calendarRoutes from './routes/calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // מאחורי Render / Cloud Run וכו' — לזיהוי IP נכון ב-rate limit

  // CORS רק לכתובות שהוגדרו (כשהלקוח מתארח בדומיין אחר, למשל Firebase Hosting)
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length) {
    app.use('/api', cors({ origin: allowed }));
  }

  app.use(express.json({ limit: '200kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(authRoutes);
  api.use(organizationRoutes);
  api.use(userRoutes);
  api.use(shiftRoutes);
  api.use(replacementRoutes);
  api.use(constraintRoutes);
  api.use(periodRoutes);
  api.use(calendarRoutes);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, api);

  app.use('/api', (req, res) => res.status(404).json({ error: `נתיב לא קיים: ${req.method} ${req.originalUrl}` }));

  // הגשת ה-Frontend הבנוי (כשהשרת והלקוח רצים יחד)
  const distPath = path.join(__dirname, '..', 'shifts-client', 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }));
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  // טיפול מרכזי בשגיאות — Express 5 מעביר לכאן גם שגיאות מפונקציות async
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'גוף הבקשה אינו JSON תקין' });
    }
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: 'שגיאת שרת' });
  });

  return app;
}
