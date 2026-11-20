import { useCallback, useEffect, useState } from 'react';
import { Bell, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatDate } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AsyncButton, EmptyState, Field, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

const initialForm = { title: '', description: '', category: 'General', important: false, expiresAt: '' };

export default function AnnouncementsPage() {
  const { profile } = useAuth();
  const admin = profile.role === 'admin';
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api('/announcements');
      setItems(result.announcements);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish(event) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await api('/announcements', { method: 'POST', body: { ...form, expiresAt: form.expiresAt || null } });
      setForm(initialForm); setSuccess('Announcement published.'); await load();
    } catch (publishError) { setError(publishError.message); }
    finally { setBusy(false); }
  }

  async function markRead(id) {
    setError('');
    try {
      await api(`/announcements/${id}/read`, { method: 'POST', body: {} });
      setItems(current => current.map(item => item.id === id
        ? { ...item, announcement_recipients: item.announcement_recipients.map(recipient =>
          recipient.employee_id === profile.id ? { ...recipient, read_at: new Date().toISOString() } : recipient) } : item));
    } catch (readError) { setError(readError.message); }
  }

  async function edit(item) {
    const title = window.prompt('Edit announcement title', item.title);
    if (title === null) return;
    const description = window.prompt('Edit announcement description', item.description);
    if (description === null) return;
    setError('');
    try {
      await api(`/announcements/${item.id}`, { method: 'PATCH', body: { title, description } });
      setSuccess('Announcement updated.'); await load();
    } catch (editError) { setError(editError.message); }
  }

  async function remove(item) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    setError('');
    try {
      await api(`/announcements/${item.id}`, { method: 'DELETE' });
      setItems(current => current.filter(entry => entry.id !== item.id));
      setSuccess('Announcement deleted.');
    } catch (deleteError) { setError(deleteError.message); }
  }

  return <div>
    <PageHeader eyebrow="COMPANY COMMUNICATION" title="Announcements" description={admin ? 'Share company news, important notices, and updates.' : 'The latest news and notices from your team.'} />
    <Notice>{error}</Notice><Notice tone="success">{success}</Notice>
    {admin && <Panel title="Create an announcement" className="composer-panel">
      <form className="announcement-form" onSubmit={publish}>
        <div className="form-two"><Field label="Title" placeholder="What should everyone know?" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required />
          <label className="field"><span>Category</span><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
            <option>General</option><option>People</option><option>Policy</option><option>Event</option><option>Operations</option>
          </select></label></div>
        <Field as="textarea" label="Description" placeholder="Write the announcement…" rows={4} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} required />
        <div className="form-three"><Field label="Expires on (optional)" type="date" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} />
          <label className="toggle-field"><input type="checkbox" checked={form.important} onChange={event => setForm({ ...form, important: event.target.checked })} /><span>Mark as important</span></label></div>
        <p className="panel-intro">Announcements are shared with all employees.</p>
        <AsyncButton className="button button-primary" type="submit" busy={busy}><Plus size={16} />Publish announcement</AsyncButton>
      </form>
    </Panel>}
    <Panel title={admin ? 'Published announcements' : 'For you'} action={<span className="count-pill">{items.length} updates</span>}>
      {loading ? <Loading /> : items.length ? <div className="announcement-list">{items.map(item => {
        const receipt = item.announcement_recipients?.find(row => row.employee_id === profile.id);
        const isRead = Boolean(receipt?.read_at);
        return <article className={`announcement-card ${item.important ? 'announcement-important' : ''}`} key={item.id}>
          <div className="announcement-symbol"><Bell size={18} /></div>
          <div className="announcement-body">
            <div className="announcement-topline"><StatusBadge tone={item.important ? 'important' : 'neutral'}>{item.important ? 'Important' : item.category}</StatusBadge>
              <span>Published {formatDate(item.published_at)}</span>{item.expires_at && <span>· Expires {formatDate(item.expires_at)}</span>}</div>
            <h3>{item.title}</h3><p>{item.description}</p>
            {!admin && <button className={`text-button read-button ${isRead ? 'read-done' : ''}`} disabled={isRead} onClick={() => markRead(item.id)}>{isRead ? 'Read' : 'Mark as read'}</button>}
          </div>
          {admin && <div className="card-actions"><button title="Edit announcement" onClick={() => edit(item)}><Pencil size={15} /></button><button title="Delete announcement" onClick={() => remove(item)}><Trash2 size={15} /></button></div>}
          {!admin && !isRead && <span className="unread-dot" title="Unread" />}
        </article>;
      })}</div> : <EmptyState title="No announcements yet" message="When there's news to share, it will appear here." />}
    </Panel>
  </div>;
}
