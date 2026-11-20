import { Router } from 'express';
import { notificationsStore } from '../utils/notificationsStore.js';
import { ensureEmployeeRecord } from '../utils/employees.js';

const router = Router();

// GET /api/notifications
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.profile.role === 'admin';
    const { employee } = await ensureEmployeeRecord(req.profile);
    const result = await notificationsStore.getNotifications(req.user.id, isAdmin, employee?.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load notifications.' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    notificationsStore.markAsRead(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update notification.' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    notificationsStore.markAllAsRead(req.user.id);
    res.json({ ok: true, message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not mark all notifications as read.' });
  }
});

export default router;
