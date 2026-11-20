import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authenticate } from './middleware/auth.js';
import sessionsRouter from './routes/sessions.js';
import attendanceRouter from './routes/attendance.js';
import announcementsRouter from './routes/announcements.js';
import meetingsRouter from './routes/meetings.js';
import assignmentsRouter from './routes/assignments.js';
import hourlyRouter from './routes/hourly.js';
import leavesRouter from './routes/leaves.js';
import profileRouter from './routes/profile.js';
import reportsRouter from './routes/reports.js';
import chatRouter from './routes/chat.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';

const app = express();
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
}));

app.use(cors({
  origin(origin, callback) {
    // In local development or enterprise internal network, allow all origins
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Arshith Connect API' }));
app.use('/api/profile', authenticate, profileRouter);
app.use('/api/reports', authenticate, reportsRouter);
app.use('/api/sessions', authenticate, sessionsRouter);
app.use('/api/attendance', authenticate, attendanceRouter);
app.use('/api/chat', authenticate, chatRouter);
app.use('/api/announcements', authenticate, announcementsRouter);
app.use('/api/meetings', authenticate, meetingsRouter);
app.use('/api/assignments', authenticate, assignmentsRouter);
app.use('/api/hourly-updates', authenticate, hourlyRouter);
app.use('/api/leaves', authenticate, leavesRouter);
app.use('/api/settings', authenticate, settingsRouter);
app.use('/api/notifications', authenticate, notificationsRouter);
app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, '0.0.0.0', () => console.log(`Arshith Connect API listening on port ${port} (0.0.0.0)`));
