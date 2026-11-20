import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, FileText, MessageCircle, Paperclip, Plus, RotateCw,
  Search, Send, Settings2, Trash2, Users, X,
} from 'lucide-react';
import { api, formatDate, formatTime } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { EmptyState, Loading, Notice, PageHeader } from '../components/ui.jsx';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AC';
}

function ChatAvatar({ name, src, size = 'normal' }) {
  return <span className={`chat-avatar chat-avatar-${size}`}>
    {src ? <img src={src} alt="" /> : initials(name)}
  </span>;
}

async function signedMediaUrls(paths) {
  const distinctPaths = [...new Set(paths.filter(Boolean))];
  if (!distinctPaths.length) return {};
  const results = await Promise.all(distinctPaths.map(async path => {
    const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 600);
    if (error) throw new Error(`Could not load a chat image: ${error.message}`);
    return [path, data.signedUrl];
  }));
  return Object.fromEntries(results);
}

async function hydrateMessages(messages) {
  const paths = messages.flatMap(message => [
    message.sender?.avatar_path,
    ...message.attachments.map(item => item.storage_path),
  ]);
  const urls = await signedMediaUrls(paths);
  return {
    urls,
    messages: messages.map(message => ({
      ...message,
      sender: { ...message.sender, avatar_url: urls[message.sender?.avatar_path] || '' },
      attachments: message.attachments.map(item => ({ ...item, url: urls[item.storage_path] })),
    })),
  };
}

function conversationTitle(conversation, userId) {
  if (conversation.kind === 'group') return conversation.name;
  const peers = (conversation.members || []).filter(member => member.id !== userId);
  return peers.map(member => member.full_name).join(', ') || 'Private conversation';
}

function conversationAvatar(conversation, userId, urls) {
  if (conversation.kind === 'group') return urls[conversation.image_path] || '';
  const peer = (conversation.members || []).find(member => member.id !== userId);
  return urls[peer?.avatar_path] || '';
}

export default function ChatPage() {
  const { user, profile } = useAuth();
  const admin = profile.role === 'admin';
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [people, setPeople] = useState([]);
  const [conversationSearch, setConversationSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [groupMode, setGroupMode] = useState('');
  const [groupForm, setGroupForm] = useState({ name: '', description: '', memberIds: [] });
  const [groupImage, setGroupImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mediaUrls, setMediaUrls] = useState({});
  const fileInput = useRef(null);
  const messagesEnd = useRef(null);
  const messagesContainer = useRef(null);

  const loadConversations = useCallback(async () => {
    const result = await api('/chat/conversations');
    const paths = [];
    for (const conversation of result.conversations) {
      paths.push(conversation.image_path);
      if (conversation.kind === 'direct') {
        paths.push(conversation.members.find(member => member.id !== user.id)?.avatar_path);
      }
    }
    const urls = await signedMediaUrls(paths);
    setMediaUrls(current => ({ ...current, ...urls }));
    setConversations(result.conversations);
    setSelectedId(current => current && result.conversations.some(item => item.id === current)
      ? current : result.conversations[0]?.id || '');
    return result.conversations;
  }, [user.id]);

  const loadPeople = useCallback(async search => {
    const suffix = search ? `?q=${encodeURIComponent(search)}` : '';
    const result = await api(`/chat/people${suffix}`);
    setPeople(result.people);
  }, []);

  const loadMessages = useCallback(async conversationId => {
    if (!conversationId) {
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }
    setMessagesLoading(true);
    try {
      const result = await api(`/chat/conversations/${conversationId}/messages`);
      const hydrated = await hydrateMessages(result.messages);
      setMediaUrls(current => ({ ...current, ...hydrated.urls }));
      setMessages(hydrated.messages);
      setHasMoreMessages(result.has_more);
      await api(`/chat/conversations/${conversationId}/read`, { method: 'POST', body: {} });
      await loadConversations();
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setMessagesLoading(false);
    }
  }, [loadConversations]);

  async function loadOlderMessages() {
    if (!selectedId || !messages.length || olderLoading || !hasMoreMessages) return;
    setOlderLoading(true);
    setError('');
    const container = messagesContainer.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    try {
      const cursor = messages[0];
      const result = await api(`/chat/conversations/${selectedId}/messages?before=${encodeURIComponent(cursor.created_at)}&beforeId=${encodeURIComponent(cursor.id)}`);
      const hydrated = await hydrateMessages(result.messages);
      setMediaUrls(current => ({ ...current, ...hydrated.urls }));
      setHasMoreMessages(result.has_more);
      setMessages(current => [...hydrated.messages, ...current]);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - previousHeight + previousTop;
      });
    } catch (loadError) { setError(loadError.message); }
    finally { setOlderLoading(false); }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadConversations().catch(loadError => {
      if (active) setError(loadError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadConversations]);

  useEffect(() => {
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPeople(peopleSearch).catch(loadError => setError(loadError.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [peopleSearch, loadPeople]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    const channel = supabase.channel(`chat-feed-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      }, event => {
        loadConversations().catch(loadError => setError(loadError.message));
        if (event.new.conversation_id === selectedId) loadMessages(selectedId);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_conversations',
      }, () => {
        loadConversations().catch(loadError => setError(loadError.message));
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_members',
      }, () => {
        loadConversations().catch(loadError => setError(loadError.message));
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_message_attachments',
      }, () => {
        if (selectedId) loadMessages(selectedId);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_message_reads',
      }, () => {
        if (selectedId) loadMessages(selectedId);
        loadConversations().catch(loadError => setError(loadError.message));
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Real-time chat is unavailable. Check your connection or refresh the conversation.');
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [loadConversations, loadMessages, selectedId, user?.id]);

  useEffect(() => {
    if (!olderLoading) messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const selectedConversation = conversations.find(conversation => conversation.id === selectedId) || null;
  const filteredConversations = useMemo(() => conversations.filter(conversation => {
    const title = conversationTitle(conversation, user.id).toLocaleLowerCase();
    const query = conversationSearch.trim().toLocaleLowerCase();
    return !query || title.includes(query) || (conversation.last_message?.content || '').toLocaleLowerCase().includes(query);
  }), [conversationSearch, conversations, user.id]);

  function chooseFiles(event) {
    const selected = [...event.target.files];
    event.target.value = '';
    if (!selected.length) return;
    if (selected.length + files.length > MAX_ATTACHMENTS) {
      setError(`Attach no more than ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const invalid = selected.find(file => !ALLOWED_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE);
    if (invalid) {
      setError('Attachments must be supported images or common documents no larger than 10 MB each.');
      return;
    }
    setError('');
    setFiles(current => [...current, ...selected]);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!selectedConversation || busy || (!draft.trim() && !files.length)) return;
    setBusy(true);
    setError('');
    const uploadedPaths = [];
    try {
      const attachments = [];
      for (const file of files) {
        const prepared = await api(`/chat/conversations/${selectedId}/attachments`, {
          method: 'POST',
          body: { file_name: file.name, mime_type: file.type, file_size: file.size },
        });
        const { error: uploadError } = await supabase.storage.from('chat-media')
          .uploadToSignedUrl(prepared.storage_path, prepared.token, file, { contentType: file.type });
        if (uploadError) throw new Error(`Could not upload ${file.name}: ${uploadError.message}`);
        uploadedPaths.push(prepared.storage_path);
        attachments.push({
          storage_path: prepared.storage_path,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
      }
      const sent = await api(`/chat/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: { content: draft, attachments },
      });
      setDraft('');
      setFiles([]);
      uploadedPaths.length = 0;
      if (sent.warning) setNotice(sent.warning);
      await Promise.all([loadMessages(selectedId), loadConversations()]);
    } catch (sendError) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('chat-media').remove(uploadedPaths);
        if (cleanupError) setError(`${sendError.message} Uploaded files could not be removed: ${cleanupError.message}`);
        else setError(sendError.message);
      } else setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function startDirectChat(person) {
    setError('');
    setBusy(true);
    try {
      const result = await api('/chat/conversations/direct', { method: 'POST', body: { peerId: person.id } });
      await loadConversations();
      setSelectedId(result.conversation.id);
      setPeopleSearch('');
      setNotice(`Private conversation with ${person.full_name} is ready.`);
    } catch (startError) { setError(startError.message); }
    finally { setBusy(false); }
  }

  async function uploadGroupImage(conversationId, image) {
    if (!image) return null;
    const prepared = await api(`/chat/conversations/${conversationId}/group-image-upload`, {
      method: 'POST',
      body: { file_name: image.name, mime_type: image.type, file_size: image.size },
    });
    const { error: uploadError } = await supabase.storage.from('chat-media')
      .uploadToSignedUrl(prepared.storage_path, prepared.token, image, { contentType: image.type });
    if (uploadError) throw new Error(`Could not upload the group image: ${uploadError.message}`);
    return prepared.storage_path;
  }

  async function saveGroup(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    let createdGroupId = '';
    try {
      if (groupMode === 'create') {
        const result = await api('/chat/conversations/groups', {
          method: 'POST',
          body: { ...groupForm, memberIds: groupForm.memberIds },
        });
        createdGroupId = result.conversation.id;
        if (groupImage) {
          const imagePath = await uploadGroupImage(result.conversation.id, groupImage);
          await api(`/chat/conversations/${result.conversation.id}`, {
            method: 'PATCH', body: { image_path: imagePath },
          });
        }
        await loadConversations();
        setSelectedId(result.conversation.id);
      } else {
        await api(`/chat/conversations/${selectedConversation.id}`, {
          method: 'PATCH',
          body: { name: groupForm.name, description: groupForm.description },
        });
        const currentMemberIds = selectedConversation.members.map(member => member.id);
        const added = groupForm.memberIds.filter(id => !currentMemberIds.includes(id));
        const removed = currentMemberIds.filter(id => id !== selectedConversation.created_by && !groupForm.memberIds.includes(id));
        if (added.length) await api(`/chat/conversations/${selectedConversation.id}/members`, {
          method: 'POST', body: { memberIds: added },
        });
        for (const id of removed) {
          await api(`/chat/conversations/${selectedConversation.id}/members/${id}`, { method: 'DELETE' });
        }
        if (groupImage) {
          const imagePath = await uploadGroupImage(selectedConversation.id, groupImage);
          await api(`/chat/conversations/${selectedConversation.id}`, {
            method: 'PATCH', body: { image_path: imagePath },
          });
        }
        await loadConversations();
      }
      setGroupMode('');
      setGroupImage(null);
      setNotice(groupMode === 'create' ? 'Group created.' : 'Group updated.');
    } catch (saveError) {
      if (createdGroupId) {
        setSelectedId(createdGroupId);
        setGroupMode('');
        setGroupImage(null);
        try {
          await loadConversations();
          setNotice(`Group created, but a follow-up step failed: ${saveError.message}`);
        } catch (loadError) {
          setError(`Group created, but could not reload it: ${loadError.message}`);
        }
      } else setError(saveError.message);
    }
    finally { setBusy(false); }
  }

  function openCreateGroup() {
    setGroupForm({ name: '', description: '', memberIds: [] });
    setGroupImage(null);
    setGroupMode('create');
  }

  function openEditGroup() {
    setGroupForm({
      name: selectedConversation.name,
      description: selectedConversation.description || '',
      memberIds: selectedConversation.members.filter(member => member.id !== user.id).map(member => member.id),
    });
    setGroupImage(null);
    setGroupMode('edit');
  }

  async function deleteGroup() {
    if (!selectedConversation || !window.confirm(`Delete the group “${selectedConversation.name}”? This removes it from member chat lists.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/chat/conversations/${selectedConversation.id}`, { method: 'DELETE' });
      setSelectedId('');
      setMessages([]);
      setGroupMode('');
      await loadConversations();
      setNotice('Group deleted.');
    } catch (deleteError) { setError(deleteError.message); }
    finally { setBusy(false); }
  }

  const selectedMembers = selectedConversation?.members || [];

  return <div className="chat-page">
    <PageHeader eyebrow="TEAM COMMUNICATION" title="Chat" description="Private employee conversations and company groups."
      action={admin && <button className="button button-primary" onClick={openCreateGroup}><Users size={15} />Create group</button>} />
    <Notice>{error}</Notice><Notice tone="success">{notice}</Notice>
    <div className={`chat-layout ${selectedId ? 'chat-show-conversation' : ''}`}>
      <aside className="chat-sidebar">
        <div className="chat-search"><Search size={16} /><input value={conversationSearch} onChange={event => setConversationSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></div>
        <label className="chat-people-search"><span>Start a private chat</span><div><Search size={15} /><input value={peopleSearch} onChange={event => setPeopleSearch(event.target.value)} placeholder="Find an employee" aria-label="Find an employee" /></div></label>
        {peopleSearch.trim() && <div className="chat-people-results">
          {people.length ? people.map(person => <button key={person.id} disabled={busy} onClick={() => startDirectChat(person)}>
            <ChatAvatar name={person.full_name} src={mediaUrls[person.avatar_path]} size="small" />
            <span><strong>{person.full_name}</strong><small>{person.department || person.email}</small></span><MessageCircle size={15} />
          </button>) : <span className="chat-no-results">No active employees found.</span>}
        </div>}
        <div className="chat-list-heading"><span>Recent conversations</span><button aria-label="Refresh conversations" title="Refresh conversations" onClick={() => loadConversations().catch(loadError => setError(loadError.message))}><RotateCw size={15} /></button></div>
        <div className="chat-conversation-list">
          {loading ? <Loading label="Loading conversations…" /> : filteredConversations.length
            ? filteredConversations.map(conversation => <button key={conversation.id}
              className={`chat-conversation ${selectedId === conversation.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(conversation.id)}>
              <ChatAvatar name={conversationTitle(conversation, user.id)}
                src={conversationAvatar(conversation, user.id, mediaUrls)} />
              <span className="chat-conversation-copy"><strong>{conversationTitle(conversation, user.id)}</strong>
                <small>{conversation.last_message?.content || (conversation.kind === 'group' ? 'Group conversation' : 'Start a conversation')}</small></span>
              <span className="chat-conversation-meta"><small>{conversation.last_message ? formatTime(conversation.last_message.created_at) : ''}</small>
                {conversation.unread_count > 0 && <b>{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</b>}</span>
            </button>)
            : <EmptyState title="No conversations yet" message="Search for an employee to start a private chat." />}
        </div>
      </aside>

      <section className="chat-main">
        {selectedConversation ? <>
          <header className="chat-main-header">
            <button className="chat-back-button" aria-label="Back to conversations" onClick={() => setSelectedId('')}><ArrowLeft size={17} /></button>
            <ChatAvatar name={conversationTitle(selectedConversation, user.id)}
              src={conversationAvatar(selectedConversation, user.id, mediaUrls)} />
            <div className="chat-heading-copy"><strong>{conversationTitle(selectedConversation, user.id)}</strong>
              <small>{selectedConversation.kind === 'group'
                ? `${selectedMembers.length} members${selectedConversation.description ? ` · ${selectedConversation.description}` : ''}`
                : admin ? 'Private employee conversation' : 'Private conversation'}</small></div>
            {admin && selectedConversation.kind === 'group' && <button className="button button-outline button-small" onClick={openEditGroup}><Settings2 size={14} />Manage group</button>}
            <button className="chat-refresh" title="Refresh messages" aria-label="Refresh messages" onClick={() => loadMessages(selectedId)}><RotateCw size={15} /></button>
          </header>
          <div className="chat-messages" ref={messagesContainer}>
            {hasMoreMessages && <button className="chat-load-older" disabled={olderLoading || messagesLoading} onClick={loadOlderMessages}>
              {olderLoading ? 'Loading older messages…' : 'Load older messages'}
            </button>}
            {messagesLoading ? <Loading label="Loading messages…" />
              : messages.length ? messages.map(message => {
                const own = message.sender_id === user.id;
                const peersCount = selectedMembers.filter(member => member.id !== message.sender_id).length;
                const readCount = (message.reads || []).filter(read => read.user_id !== message.sender_id).length;
                return <article className={`chat-message ${own ? 'own' : ''}`} key={message.id}>
                  {!own && <ChatAvatar name={message.sender?.full_name} src={message.sender?.avatar_url} size="small" />}
                  <div className="chat-message-content">
                    {!own && <strong className="chat-sender">{message.sender?.full_name || 'Employee'}</strong>}
                    <div className="chat-bubble">
                      {message.content && <p>{message.content}</p>}
                      {message.attachments.map(attachment => <a key={attachment.id || attachment.storage_path} className="chat-attachment"
                        href={attachment.url} target="_blank" rel="noreferrer" download={attachment.file_name}>
                        {attachment.mime_type.startsWith('image/') ? <img src={attachment.url} alt={attachment.file_name} /> : <FileText size={17} />}
                        <span>{attachment.file_name}</span>
                      </a>)}
                    </div>
                    <small className="chat-message-meta">{formatDate(message.created_at, { month: 'short', day: 'numeric' })} · {formatTime(message.created_at)}
                      {own && <span>{readCount >= peersCount && peersCount > 0 ? ' · Read' : ' · Sent'}</span>}</small>
                  </div>
                  {own && <ChatAvatar name={profile.full_name} src={mediaUrls[profile.avatar_path]} size="small" />}
                </article>;
              }) : <EmptyState title="Say hello" message="Send the first message in this conversation." />}
            <div ref={messagesEnd} />
          </div>
          <form className="chat-composer" onSubmit={sendMessage}>
            {files.length > 0 && <div className="chat-pending-files">{files.map((file, index) => <span key={`${file.name}-${index}`}>
              <Paperclip size={13} />{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}><X size={13} /></button>
            </span>)}</div>}
            <div className="chat-compose-row">
              <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx" onChange={chooseFiles} />
              <button type="button" className="chat-attach-button" aria-label="Attach files" title="Attach images or documents (up to 10 MB)" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>
              <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); }
              }} placeholder="Write a message…" aria-label="Write a message" maxLength={5000} rows={1} />
              <button className="chat-send-button" type="submit" disabled={busy || (!draft.trim() && !files.length)} aria-label="Send message" title="Send message">{busy ? <span className="chat-spinner" /> : <Send size={17} />}</button>
            </div>
          </form>
        </> : <div className="chat-empty-main"><EmptyState title="Your team chat" message="Choose a conversation or find an employee to start a private chat." /></div>}
      </section>
    </div>

    {groupMode && admin && <div className="modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) setGroupMode('');
    }}>
      <section className="group-dialog" role="dialog" aria-modal="true" aria-labelledby="group-title">
        <div className="group-dialog-heading">
          <div><div className="eyebrow">ADMIN CONTROLS</div><h2 id="group-title">{groupMode === 'create' ? 'Create a group' : 'Manage group'}</h2></div>
          <button className="icon-button" aria-label="Close group dialog" disabled={busy} onClick={() => setGroupMode('')}><X size={17} /></button>
        </div>
        <form className="group-form" onSubmit={saveGroup}>
          <label className="field"><span>Group name</span><input value={groupForm.name} onChange={event => setGroupForm({ ...groupForm, name: event.target.value })} maxLength={80} required /></label>
          <label className="field"><span>Description</span><textarea value={groupForm.description} onChange={event => setGroupForm({ ...groupForm, description: event.target.value })} maxLength={500} rows={2} /></label>
          <label className="field group-image-field"><span>Group image (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setGroupImage(event.target.files?.[0] || null)} />
            {groupImage && <small>{groupImage.name}</small>}</label>
          <div className="group-member-picker"><strong>Employees</strong>
            <label className="group-member-search"><Search size={14} /><input value={peopleSearch} onChange={event => setPeopleSearch(event.target.value)} placeholder="Search employees" /></label>
            <div>
            {people.map(person => {
              const checked = groupForm.memberIds.includes(person.id);
              return <label key={person.id} className="group-member-option">
                <input type="checkbox" checked={checked} onChange={() => setGroupForm(current => ({
                  ...current,
                  memberIds: checked ? current.memberIds.filter(id => id !== person.id) : [...current.memberIds, person.id],
                }))} />
                <ChatAvatar name={person.full_name} src={mediaUrls[person.avatar_path]} size="small" />
                <span><strong>{person.full_name}</strong><small>{person.department || person.email}</small></span>
              </label>;
            })}
          </div></div>
          <div className="group-dialog-actions">
            {groupMode === 'edit' && <button className="button button-danger" type="button" disabled={busy} onClick={deleteGroup}><Trash2 size={14} />Delete group</button>}
            <button className="button button-outline" type="button" disabled={busy} onClick={() => setGroupMode('')}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={busy}>{groupMode === 'create' ? <Plus size={14} /> : <Check size={14} />}{groupMode === 'create' ? 'Create group' : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>}
  </div>;
}
