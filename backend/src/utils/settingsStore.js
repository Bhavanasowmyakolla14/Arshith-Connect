import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from '../config/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, '../../data/settings-store.json');

const defaultSettings = {
  platform_name: 'ARSHITH CONNECT',
  tagline: 'One Platform. Every Connection.',
  organization_name: 'Arshith Connect',
  industry: 'Technology & Workplace Solutions',
  official_email: 'admin@arshithconnect.com',
  contact_number: '+91 98765 43210',
  office_address: 'Bangalore, India',
  website: 'https://arshithconnect.com',
  work_start: '09:00',
  work_end: '18:00',
  workdays: [1, 2, 3, 4, 5],
  time_zone: 'Asia/Kolkata',
  selfie_required: true,
  allow_remote: true,
  late_threshold_minutes: 15,
  leave_categories: ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Other'],
  notifications: {
    announcements: true,
    leave_decisions: true,
    assignments: true,
    meetings: true,
    chat_messages: true,
    hourly_reminders: true,
  },
  updated_at: new Date().toISOString(),
};

function readLocal() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, JSON.stringify(defaultSettings, null, 2), 'utf8');
      return defaultSettings;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Error reading settings store:', err);
    return defaultSettings;
  }
}

function writeLocal(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing settings store:', err);
  }
}

export const settingsStore = {
  async getSettings() {
    // Try to load company_settings from Supabase
    try {
      const { data, error } = await supabase.from('company_settings').select('*').limit(1).maybeSingle();
      if (!error && data) {
        let parsedMeta = {};
        if (data.description) {
          try { parsedMeta = JSON.parse(data.description); } catch {}
        }
        const merged = {
          ...defaultSettings,
          ...parsedMeta,
          organization_name: data.company_name || defaultSettings.organization_name,
          official_email: data.official_email || defaultSettings.official_email,
          contact_number: data.contact_number || defaultSettings.contact_number,
          office_address: data.office_address || defaultSettings.office_address,
          website: data.website || defaultSettings.website,
          industry: data.industry || defaultSettings.industry,
          updated_at: data.updated_at || defaultSettings.updated_at,
        };
        writeLocal(merged);
        return merged;
      }
    } catch {}
    return readLocal();
  },

  async updateSettings(updates, userId) {
    const current = await this.getSettings();
    const updated = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    };
    writeLocal(updated);

    // Sync to Supabase company_settings table if possible
    try {
      const { data: existing } = await supabase.from('company_settings').select('id').limit(1).maybeSingle();
      const metaToStore = JSON.stringify({
        platform_name: updated.platform_name,
        tagline: updated.tagline,
        work_start: updated.work_start,
        work_end: updated.work_end,
        workdays: updated.workdays,
        time_zone: updated.time_zone,
        selfie_required: updated.selfie_required,
        allow_remote: updated.allow_remote,
        late_threshold_minutes: updated.late_threshold_minutes,
        leave_categories: updated.leave_categories,
        notifications: updated.notifications,
      });

      if (existing?.id) {
        await supabase.from('company_settings').update({
          company_name: updated.organization_name,
          official_email: updated.official_email,
          contact_number: updated.contact_number,
          office_address: updated.office_address,
          website: updated.website,
          industry: updated.industry,
          description: metaToStore,
          updated_by: userId,
          updated_at: updated.updated_at,
        }).eq('id', existing.id);
      }
    } catch (err) {
      console.warn('Could not sync company_settings to Supabase, local persistence active:', err.message);
    }

    return updated;
  }
};
