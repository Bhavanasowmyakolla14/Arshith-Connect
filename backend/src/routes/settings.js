import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { settingsStore } from '../utils/settingsStore.js';

const router = Router();

// GET /api/settings - Authenticated users can view settings
router.get('/', async (req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load platform settings.' });
  }
});

// PATCH /api/settings - Only Admin can update settings
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const updates = req.body || {};
    const updated = await settingsStore.updateSettings(updates, req.user?.id);
    res.json({ settings: updated, message: 'Platform settings updated successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save platform settings.' });
  }
});

export default router;
