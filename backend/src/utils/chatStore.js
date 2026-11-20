import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, '../../data/chat-store.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const initial = { conversations: [], members: [], messages: [], attachments: [], reads: [] };
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading chat store:', err);
    return { conversations: [], members: [], messages: [], attachments: [], reads: [] };
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing chat store:', err);
  }
}

export const chatStore = {
  getConversations(userId, isAdmin) {
    const store = readStore();
    const active = store.conversations.filter(c => !c.deleted_at);
    if (isAdmin) return active;
    const memberConvIds = new Set(store.members.filter(m => m.user_id === userId).map(m => m.conversation_id));
    return active.filter(c => memberConvIds.has(c.id));
  },

  getConversation(id) {
    const store = readStore();
    return store.conversations.find(c => c.id === id && !c.deleted_at) || null;
  },

  getMembers(conversationId) {
    const store = readStore();
    return store.members.filter(m => m.conversation_id === conversationId);
  },

  getMembersForConversations(conversationIds) {
    const store = readStore();
    const set = new Set(conversationIds);
    return store.members.filter(m => set.has(m.conversation_id));
  },

  getMessages(conversationId, limit = 50, before = null) {
    const store = readStore();
    let msgs = store.messages.filter(m => m.conversation_id === conversationId);
    if (before) {
      const beforeTime = new Date(before).getTime();
      msgs = msgs.filter(m => new Date(m.created_at).getTime() < beforeTime);
    }
    msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const sliced = msgs.slice(0, limit);
    return sliced;
  },

  getAttachmentsForMessages(messageIds) {
    const store = readStore();
    const set = new Set(messageIds);
    return store.attachments.filter(a => set.has(a.message_id));
  },

  createDirect(user1Id, user2Id) {
    const [low, high] = [user1Id, user2Id].sort();
    const store = readStore();
    let conv = store.conversations.find(c => c.kind === 'direct' && c.direct_user_low === low && c.direct_user_high === high && !c.deleted_at);
    if (!conv) {
      conv = {
        id: randomUUID(),
        kind: 'direct',
        direct_user_low: low,
        direct_user_high: high,
        name: null,
        description: null,
        image_path: null,
        created_by: user1Id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        deleted_at: null,
      };
      store.conversations.push(conv);
      store.members.push(
        { conversation_id: conv.id, user_id: low, added_by: user1Id, joined_at: new Date().toISOString() },
        { conversation_id: conv.id, user_id: high, added_by: user1Id, joined_at: new Date().toISOString() }
      );
      writeStore(store);
    }
    return conv;
  },

  createGroup(name, description, imagePath, createdBy, memberIds) {
    const store = readStore();
    const conv = {
      id: randomUUID(),
      kind: 'group',
      direct_user_low: null,
      direct_user_high: null,
      name,
      description: description || null,
      image_path: imagePath || null,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      deleted_at: null,
    };
    store.conversations.push(conv);
    const uniqueMembers = [...new Set([createdBy, ...(memberIds || [])])];
    for (const uid of uniqueMembers) {
      store.members.push({
        conversation_id: conv.id,
        user_id: uid,
        added_by: createdBy,
        joined_at: new Date().toISOString(),
      });
    }
    writeStore(store);
    return conv;
  },

  addMessage(conversationId, senderId, content, attachments = []) {
    const store = readStore();
    const conv = store.conversations.find(c => c.id === conversationId && !c.deleted_at);
    if (!conv) throw new Error('Conversation not found.');

    const now = new Date().toISOString();
    conv.last_message_at = now;
    conv.updated_at = now;

    const message = {
      id: randomUUID(),
      conversation_id: conversationId,
      sender_id: senderId,
      content: content || '',
      created_at: now,
    };
    store.messages.push(message);

    const savedAttachments = [];
    for (const att of attachments) {
      const item = {
        id: randomUUID(),
        message_id: message.id,
        storage_path: att.storage_path,
        file_name: att.file_name,
        mime_type: att.mime_type,
        file_size: att.file_size,
        created_at: now,
      };
      store.attachments.push(item);
      savedAttachments.push(item);
    }

    // Sender automatically marks own message as read
    store.reads.push({
      message_id: message.id,
      user_id: senderId,
      read_at: now,
    });

    writeStore(store);
    return { ...message, attachments: savedAttachments };
  },

  markRead(conversationId, userId) {
    const store = readStore();
    const msgs = store.messages.filter(m => m.conversation_id === conversationId);
    const now = new Date().toISOString();
    const existingReads = new Set(store.reads.filter(r => r.user_id === userId).map(r => r.message_id));
    for (const m of msgs) {
      if (!existingReads.has(m.id)) {
        store.reads.push({ message_id: m.id, user_id: userId, read_at: now });
      }
    }
    writeStore(store);
  },

  getUnreadCount(conversationId, userId) {
    const store = readStore();
    const msgs = store.messages.filter(m => m.conversation_id === conversationId && m.sender_id !== userId);
    const readMsgIds = new Set(store.reads.filter(r => r.user_id === userId).map(r => r.message_id));
    return msgs.filter(m => !readMsgIds.has(m.id)).length;
  },

  deleteConversation(conversationId) {
    const store = readStore();
    const conv = store.conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.deleted_at = new Date().toISOString();
      writeStore(store);
    }
  },

  updateConversation(conversationId, updates) {
    const store = readStore();
    const conv = store.conversations.find(c => c.id === conversationId && !c.deleted_at);
    if (conv) {
      Object.assign(conv, updates, { updated_at: new Date().toISOString() });
      writeStore(store);
    }
    return conv;
  },

  addMember(conversationId, userId, addedBy) {
    const store = readStore();
    const exists = store.members.some(m => m.conversation_id === conversationId && m.user_id === userId);
    if (!exists) {
      store.members.push({
        conversation_id: conversationId,
        user_id: userId,
        added_by: addedBy,
        joined_at: new Date().toISOString(),
      });
      writeStore(store);
    }
  },

  removeMember(conversationId, userId) {
    const store = readStore();
    store.members = store.members.filter(m => !(m.conversation_id === conversationId && m.user_id === userId));
    writeStore(store);
  }
};
