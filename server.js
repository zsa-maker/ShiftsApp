import 'dotenv/config';
import { createApp } from './server/app.js';
import { runMigrations } from './server/migrations.js';

const PORT = process.env.PORT || 3001;

try {
  await runMigrations();
} catch (err) {
  console.error('❌ המיגרציה נכשלה — השרת לא יעלה עד שהבעיה תתוקן:', err);
  process.exit(1);
}

createApp().listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
