/**
 * AdminAuditLog - read-only view of recorded platform-admin actions.
 *
 * Every successful mutating request to /api/admin/* is recorded server-side
 * by the adminAudit middleware (actor, action, target, status, IP, redacted
 * body). This page lists them newest-first with a "Load more" pager. Each row
 * expands to show the captured params + redacted request body.
 *
 * Pure accountability / traceability - no actions are taken from this page.
 */

import { useEffect, useState } from 'react';
import api from '../../lib/api';

const METHOD_STYLES = {
  POST:   { bg: '#EDF5EE', fg: '#3C7842' },
  PATCH:  { bg: '#F1EEF8', fg: '#6B3FA0' },
  PUT:    { bg: '#F1EEF8', fg: '#6B3FA0' },
  DELETE: { bg: '#FDF0EB', fg: '#B14828' },
};

function MethodPill({ method }) {
  const s = METHOD_STYLES[method] || { bg: '#E8E5EC', fg: '#6B6774' };
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
      {method}
    </span>
  );
}

function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const PAGE = 100;

export default function AdminAuditLog() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  async function loadPage(offset) {
    try {
      const { data } = await api.get('/admin/audit-log', { params: { limit: PAGE, offset } });
      // Offset paging over a growing newest-first table can re-surface a row if
      // an action is logged mid-session; de-dup by id on append so we never
      // render a duplicate (or collide React keys).
      setEntries((prev) => {
        if (offset === 0) return data.entries;
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...(data.entries || []).filter((e) => !seen.has(e.id))];
      });
      setTotal(data.total || 0);
    } catch {
      setError('Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPage(0); }, []);

  if (loading) return <p style={{ color: '#6B6774' }}>Loading…</p>;
  if (error) return <p style={{ color: '#B14828' }}>{error}</p>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: '#2D2A33', marginBottom: 4 }}>Audit log</h1>
      <p style={{ color: '#6B6774', fontSize: 14, marginBottom: 20 }}>
        Every successful admin action, newest first. {total} recorded.
      </p>

      {entries.length === 0 ? (
        <p style={{ color: '#6B6774' }}>No admin actions recorded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((e) => {
            const isOpen = expanded === e.id;
            const hasDetail = (e.params && Object.keys(e.params).length) || (e.body && Object.keys(e.body).length);
            return (
              <div key={e.id} style={{ background: '#FFF', border: '1px solid #E8E5EC', borderRadius: 12, padding: '10px 14px' }}>
                <div
                  onClick={() => hasDetail && setExpanded(isOpen ? null : e.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: hasDetail ? 'pointer' : 'default', flexWrap: 'wrap' }}
                >
                  <MethodPill method={e.method} />
                  <code style={{ fontSize: 13, color: '#2D2A33' }}>{e.path}</code>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: e.status_code >= 400 ? '#B14828' : '#6B6774' }}>{e.status_code}</span>
                  <span style={{ fontSize: 12, color: '#6B6774' }}>{e.actor_name || e.actor_user_id || 'unknown'}</span>
                  <span style={{ fontSize: 12, color: '#8A8493', whiteSpace: 'nowrap' }}>{formatTimestamp(e.created_at)}</span>
                </div>
                {isOpen && hasDetail && (
                  <pre style={{ marginTop: 8, padding: 10, background: '#FBF8F3', borderRadius: 8, fontSize: 12, color: '#2D2A33', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify({ target_id: e.target_id, ip: e.ip, params: e.params, body: e.body }, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {entries.length < total && (
        <button
          onClick={() => loadPage(entries.length)}
          style={{ marginTop: 16, background: '#FFF', border: '1.5px solid #6B3FA0', color: '#6B3FA0', fontWeight: 600, fontSize: 14, padding: '8px 16px', borderRadius: 12, cursor: 'pointer' }}
        >
          Load more ({total - entries.length} left)
        </button>
      )}
    </div>
  );
}
