import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { supabase } from '../config/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, '../../data/notifications-store.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const initial = { notifications: [] };
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading notifications store:', err);
    return { notifications: [] };
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing notifications store:', err);
  }
}

export const notificationsStore = {
  addNotification({ userId, title, message, type = 'info', link = null, meta = {} }) {
    const store = readStore();
    const item = {
      id: randomUUID(),
      user_id: userId, // target user id or null for broadcast
      title,
      message,
      type, // 'announcement', 'leave', 'assignment', 'meeting', 'chat', 'hourly', 'attendance'
      link,
      meta,
      read: false,
      created_at: new Date().toISOString(),
    };
    store.notifications.unshift(item);
    if (store.notifications.length > 500) {
      store.notifications = store.notifications.slice(0, 500);
    }
    writeStore(store);
    return item;
  },

  async getNotifications(userId, isAdmin, employeeId = null) {
    const store = readStore();
    // Dynamically compile active live notifications from Supabase data as well
    const dynamicItems = [];

    try {
      // 1. Announcements for all employees
      const { data: announcements } = await supabase.from('announcements')
        .select('id, title, category, published_at, is_pinned')
        .order('published_at', { ascending: false })
        .limit(10);
      if (announcements) {
        for (const a of announcements) {
          dynamicItems.push({
            id: `ann-${a.id}`,
            user_id: userId,
            title: `Announcement: ${a.title}`,
            message: `New company update in category ${a.category || 'General'}.`,
            type: 'announcement',
            link: 'announcements',
            created_at: a.published_at,
            read: false,
          });
        }
      }

      // 2. Upcoming meetings
      const { data: meetings } = await supabase.from('meetings')
        .select('id, title, starts_at, join_url, location')
        .gte('starts_at', new Date(Date.now() - 3600000).toISOString())
        .order('starts_at', { ascending: true })
        .limit(5);
      if (meetings) {
        for (const m of meetings) {
          dynamicItems.push({
            id: `meet-${m.id}`,
            user_id: userId,
            title: `Meeting: ${m.title}`,
            message: `Scheduled for ${new Date(m.starts_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`,
            type: 'meeting',
            link: 'meetings',
            created_at: m.starts_at,
            read: false,
          });
        }
      }

      if (isAdmin) {
        // Admin: Pending leaves
        const { data: pendingLeaves } = await supabase.from('leave_applications')
          .select('id, leave_type, start_date, end_date, employees(full_name)')
          .eq('status', 'Pending')
          .limit(10);
        if (pendingLeaves) {
          for (const l of pendingLeaves) {
            dynamicItems.push({
              id: `leave-req-${l.id}`,
              user_id: userId,
              title: `Pending Leave Request`,
              message: `${l.employees?.full_name || 'An employee'} requested ${l.leave_type} (${l.start_date} to ${l.end_date})`,
              type: 'leave',
              link: 'leaves',
              created_at: new Date().toISOString(),
              read: false,
            });
          }
        }
      } else if (employeeId) {
        // Employee: Assigned tasks
        const { data: assignments } = await supabase.from('work_assignments')
          .select('id, title, priority, due_date, status')
          .eq('employee_id', employeeId)
          .neq('status', 'completed')
          .limit(5);
        if (assignments) {
          for (const asgn of assignments) {
            dynamicItems.push({
              id: `asgn-${asgn.id}`,
              user_id: userId,
              title: `Assignment: ${asgn.title}`,
              message: `Priority: ${asgn.priority || 'medium'}. Status: ${asgn.status}`,
              type: 'assignment',
              link: 'assignments',
              created_at: new Date().toISOString(),
              read: false,
            });
          }
        }

        // Employee: Leave decision notifications
        const { data: myLeaves } = await supabase.from('leave_applications')
          .select('id, leave_type, status, reviewed_at, admin_comment')
          .eq('employee_id', employeeId)
          .neq('status', 'Pending')
          .order('reviewed_at', { ascending: false })
          .limit(5);
        if (myLeaves) {
          for (const ml of myLeaves) {
            dynamicItems.push({
              id: `leave-dec-${ml.id}`,
              user_id: userId,
              title: `Leave ${ml.status}`,
              message: `Your ${ml.leave_type} request was ${ml.status.toLowerCase()}${ml.admin_comment ? `: "${ml.admin_comment}"` : '.'}`,
              type: 'leave',
              link: 'leaves',
              created_at: ml.reviewed_at || new Date().toISOString(),
              read: false,
            });
          }
        }
      }
    } catch (err) {
      console.warn('Could not build dynamic notifications:', err.message);
    }

    // Merge manual notifications stored locally
    const customUserNotifs = store.notifications.filter(n => n.user_id === userId || n.user_id === null);
    
    // De-duplicate by id
    const seen = new Set();
    const combined = [];
    for (const item of [...customUserNotifs, ...dynamicItems]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }

    // Sort by created_at desc
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const unread_count = combined.filter(n => !n.read).length;

    return {
      notifications: combined.slice(0, 30),
      unread_count,
    };
  },

  markAsRead(notificationId, userId) {
    const store = readStore();
    const item = store.notifications.find(n => n.id === notificationId && (n.user_id === userId || n.user_id === null));
    if (item) {
      item.read = true;
      writeStore(store);
    }
  },

  markAllAsRead(userId) {
    const store = readStore();
    for (const item of store.notifications) {
      if (item.user_id === userId || item.user_id === null) {
        item.read = true;
      }
    }
    writeStore(store);
  }
};
