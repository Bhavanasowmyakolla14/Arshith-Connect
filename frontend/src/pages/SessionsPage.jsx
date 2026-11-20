import { useCallback, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { api, formatDate, formatDuration, formatTime } from '../lib/api.js';
import { EmptyState, Loading, Notice, PageHeader, Panel, StatusBadge } from '../components/ui.jsx';

export default function SessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api('/sessions?limit=50&offset=0');
      setSessions(result.sessions); setTotal(result.total);
    }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    setLoadingMore(true); setError('');
    try {
      const result = await api(`/sessions?limit=50&offset=${sessions.length}`);
      setSessions(current => [...current, ...result.sessions]); setTotal(result.total);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoadingMore(false); }
  }

  return <div>
    <PageHeader eyebrow="ACCESS AUDIT" title="Login history" description="Server-recorded sign-in and sign-out activity for employee accounts." />
    <Notice>{error}</Notice>
    <Panel title="Employee sessions" action={<span className="count-pill">{sessions.length} of {total} records</span>}>
      {loading ? <Loading /> : sessions.length ? <div className="table-wrap"><table>
        <thead><tr><th>EMPLOYEE</th><th>LOGIN DATE</th><th>LOGIN TIME</th><th>LOGOUT TIME</th><th>DURATION</th><th>STATUS</th></tr></thead>
        <tbody>{sessions.map(session => <tr key={session.id}>
          <td><strong>{session.profiles?.full_name || 'Employee'}</strong><small>{session.profiles?.email}</small></td>
          <td>{formatDate(session.login_at)}</td><td>{formatTime(session.login_at)}</td>
          <td>{session.logout_at ? `${formatDate(session.logout_at)} · ${formatTime(session.logout_at)}` : '—'}</td>
          <td>{formatDuration(session.duration_seconds)}</td>
          <td><StatusBadge tone={session.status}>{session.status === 'incomplete' ? 'Incomplete' : session.status === 'active' ? 'Active' : 'Completed'}</StatusBadge></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No sessions yet" message="Sign-in history appears here when employees log in." />}
      <div className="table-footnote"><Clock3 size={14} />An incomplete session means no logout was recorded; it is not counted as a completed logout.</div>
      {sessions.length < total && <button className="button button-outline button-small load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load older sessions'}</button>}
    </Panel>
  </div>;
}
