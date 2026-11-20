import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendDbError } from '../utils/http.js';
import { chatStore } from '../utils/chatStore.js';

const router = Router();
const CHAT_BUCKET = 'chat-media';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function employeeProfiles(ids) {
  if (!ids.length) return { profiles: [], error: null };
  const { data, error } = await supabase.from('profiles')
    .select('id,full_name,email,department,job_title,role,is_active')
    .in('id', ids);
  return { profiles: (data || []).map(p => ({ ...p, avatar_path: null })), error };
}

async function getConversationAccess(req, res, conversationId) {
  if (!isUuid(conversationId)) {
    res.status(400).json({ error: 'Invalid conversation ID.' });
    return null;
  }
  const conv = chatStore.getConversation(conversationId);
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found.' });
    return null;
  }
  const members = chatStore.getMembers(conversationId);
  const isMember = members.some(m => m.user_id === req.user.id);
  const isAdmin = req.profile.role === 'admin';
  if (!isAdmin && !isMember) {
    res.status(404).json({ error: 'Conversation not found.' });
    return null;
  }
  return { conversation: conv, members, isMember, isAdmin };
}

// 1. Search employees for chat
router.get('/people', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80).replace(/[^a-zA-Z0-9@ _-]/g, '');
  let peopleQuery = supabase.from('profiles')
    .select('id,full_name,email,department,job_title,role')
    .eq('is_active', true);

  if (query) {
    const filter = `%${query}%`;
    peopleQuery = peopleQuery.or(`full_name.ilike.${filter},email.ilike.${filter}`);
  }
  const { data: profiles, error } = await peopleQuery.order('full_name', { ascending: true }).limit(60);
  if (error) return sendDbError(res, error, 'Could not search employees.');
  res.json({ people: (profiles || []).filter(person => person.id !== req.user.id) });
});

// 2. List conversations
router.get('/conversations', async (req, res) => {
  try {
    const isAdmin = req.profile.role === 'admin';
    const conversations = chatStore.getConversations(req.user.id, isAdmin);
    if (!conversations.length) return res.json({ conversations: [] });

    const ids = conversations.map(c => c.id);
    const memberships = chatStore.getMembersForConversations(ids);
    const userIds = [...new Set(memberships.map(m => m.user_id))];

    const { profiles } = await employeeProfiles(userIds);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const membersByConv = new Map();
    for (const m of memberships) {
      const list = membersByConv.get(m.conversation_id) || [];
      const prof = profileMap.get(m.user_id);
      if (prof) list.push(prof);
      membersByConv.set(m.conversation_id, list);
    }

    const payload = conversations.map(c => {
      const messages = chatStore.getMessages(c.id, 1);
      const lastMsg = messages[0] || null;
      const unread = isAdmin ? 0 : chatStore.getUnreadCount(c.id, req.user.id);
      return {
        ...c,
        members: membersByConv.get(c.id) || [],
        last_message: lastMsg,
        unread_count: unread,
      };
    });

    res.json({ conversations: payload });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load conversations.' });
  }
});

// 3. Start or get direct conversation
router.post('/conversations/direct', async (req, res) => {
  const peerId = req.body?.peerId;
  if (!isUuid(peerId) || peerId === req.user.id) {
    return res.status(400).json({ error: 'Choose a valid employee to start a conversation.' });
  }
  const { data: peer, error: peerError } = await supabase.from('profiles')
    .select('id,role,is_active').eq('id', peerId).maybeSingle();
  if (peerError || !peer || peer.is_active === false) {
    return res.status(404).json({ error: 'Active employee could not be found.' });
  }

  const conv = chatStore.createDirect(req.user.id, peerId);
  res.status(201).json({ conversation: conv });
});

// 4. Create group conversation (Admin)
router.post('/conversations/groups', requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const memberIds = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds)] : [];

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Group name must be between 2 and 80 characters.' });
  }
  const conv = chatStore.createGroup(name, description, null, req.user.id, memberIds);
  res.status(201).json({ conversation: conv });
});

// 5. Update group
router.patch('/conversations/:id', requireAdmin, async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  if (access.conversation.kind !== 'group') return res.status(400).json({ error: 'Only groups can be edited.' });

  const updates = {};
  if ('name' in req.body) updates.name = String(req.body.name || '').trim();
  if ('description' in req.body) updates.description = String(req.body.description || '').trim();
  if ('image_path' in req.body) updates.image_path = req.body.image_path;

  const updated = chatStore.updateConversation(access.conversation.id, updates);
  res.json({ conversation: updated });
});

// 6. Delete group
router.delete('/conversations/:id', requireAdmin, async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  chatStore.deleteConversation(access.conversation.id);
  res.status(204).end();
});

// 7. Add group member
router.post('/conversations/:id/members', requireAdmin, async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  for (const id of memberIds) {
    if (isUuid(id)) chatStore.addMember(access.conversation.id, id, req.user.id);
  }
  res.json({ ok: true });
});

// 8. Remove group member
router.delete('/conversations/:id/members/:userId', requireAdmin, async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  chatStore.removeMember(access.conversation.id, req.params.userId);
  res.json({ ok: true });
});

// 9. Get messages
router.get('/conversations/:id/messages', async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;

  const rawMessages = chatStore.getMessages(access.conversation.id, 100, req.query.before || null);
  const sortedMessages = [...rawMessages].reverse();

  if (!sortedMessages.length) {
    return res.json({ messages: [], has_more: false });
  }

  const senderIds = [...new Set(sortedMessages.map(m => m.sender_id))];
  const { profiles } = await employeeProfiles(senderIds);
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  const messageIds = sortedMessages.map(m => m.id);
  const attachments = chatStore.getAttachmentsForMessages(messageIds);
  const attachmentMap = new Map();
  for (const a of attachments) {
    const list = attachmentMap.get(a.message_id) || [];
    list.push(a);
    attachmentMap.set(a.message_id, list);
  }

  res.json({
    has_more: false,
    messages: sortedMessages.map(m => ({
      ...m,
      sender: profileMap.get(m.sender_id) || { id: m.sender_id, full_name: 'Team Member' },
      attachments: attachmentMap.get(m.id) || [],
      reads: [],
    })),
  });
});

// 10. Send message
router.post('/conversations/:id/messages', async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  if (!access.isMember && !access.isAdmin) {
    return res.status(403).json({ error: 'Only members can send messages.' });
  }

  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

  if (!content && !attachments.length) {
    return res.status(400).json({ error: 'Write a message or attach a file.' });
  }

  const saved = chatStore.addMessage(access.conversation.id, req.user.id, content, attachments);

  res.status(201).json({
    message: {
      ...saved,
      sender: {
        id: req.profile.id,
        full_name: req.profile.full_name,
        avatar_path: req.profile.avatar_path,
        role: req.profile.role,
      },
      reads: [],
    },
  });
});

// 11. Mark conversation as read
router.post('/conversations/:id/read', async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  chatStore.markRead(access.conversation.id, req.user.id);
  res.json({ ok: true });
});

// 12. Prepare attachment upload to Supabase Storage
router.post('/conversations/:id/attachments', async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  const fileName = typeof req.body?.file_name === 'string' ? req.body.file_name.trim() : '';
  const mimeType = typeof req.body?.mime_type === 'string' ? req.body.mime_type : '';
  const fileSize = Number(req.body?.file_size);

  if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
    return res.status(400).json({ error: 'Choose an image or document under 10 MB.' });
  }

  const extension = fileName.includes('.') ? fileName.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) : 'bin';
  const storagePath = `messages/${access.conversation.id}/${req.user.id}/${randomUUID()}.${extension || 'bin'}`;
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUploadUrl(storagePath);
  if (error) return sendDbError(res, error, 'Could not prepare upload URL.');
  res.status(201).json({ storage_path: storagePath, token: data.token, signed_url: data.signedUrl });
});

// 13. Prepare group image upload
router.post('/conversations/:id/group-image-upload', requireAdmin, async (req, res) => {
  const access = await getConversationAccess(req, res, req.params.id);
  if (!access) return;
  const extension = 'jpg';
  const storagePath = `groups/${access.conversation.id}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUploadUrl(storagePath);
  if (error) return sendDbError(res, error, 'Could not prepare group image upload.');
  res.status(201).json({ storage_path: storagePath, token: data.token, signed_url: data.signedUrl });
});

// 14. Avatar upload
router.post('/avatar-upload', async (req, res) => {
  const extension = 'jpg';
  const storagePath = `avatars/${req.user.id}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from('avatars').createSignedUploadUrl(storagePath);
  if (error) return sendDbError(res, error, 'Could not prepare avatar upload.');
  res.status(201).json({ storage_path: storagePath, token: data.token, signed_url: data.signedUrl });
});

export default router;
