/**
 * AdminDeletions - read-only view of the deletion ledger.
 *
 * Every account deletion writes a row to deletion_audit_log BEFORE the
 * destructive part (auth.js DELETE /account), so a departed user leaves a
 * trace: who, when, whether the household went with them, and - once the
 * churn migration lands - how long they stayed and where they came from.
 * This page makes that ledger visible; before it, deletions read as
 * "the account just vanishes".
 *
 * Pure visibility - no actions are taken from this page.
 */

import { useEffect, useState } from 'react';
import api from '../../lib/api';

const MODE_STYLES = {
  household_deleted: { bg: '#FDF0EB', fg: '#B14828', label: 'Household deleted' },
  user_only:         { bg: '#F1EEF8', fg: '#6B3FA0', label: 'Left household' },
};

function ModePill({ mode }) {
  const s = MODE_STYLES[mode] || { bg: '#E8E5EC', fg: '#6B6774', label: mode || 'unknown' };
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "Stayed 3 days" - deleted_at minus user_created_at. Null until the churn
 *  migration backfills new rows; old rows never have it. */
function lifespan(row) {
  if (!row.user_created_at || !row.deleted_at) return null;
  const ms = new Date(row.deleted_at) - new Date(row.user_created_at);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.round(ms / 86400000);
  if (days === 0) return 'same day';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `~${months} month${months === 1 ? '' : 's'}`;
}

export default function AdminDeletions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/admin/deletions', { params: { limit: 200 } })
      .then(({ data }) => setRows(data.deletions || []))
      .catch(() => setError('Could not load the deletion ledger.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: '#6B6774' }}>Loading…</p>;
  if (error) return <p style={{ color: '#B14828' }}>{error}</p>;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight mb-1">Deletions</h1>
      <p className="text-warm-grey text-sm mb-5">
        Every deleted account, newest first. {rows.length} recorded.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: '#6B6774' }}>No deletions recorded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => {
            const isOpen = expanded === r.id;
            const stayed = lifespan(r);
            const source = [r.signup_source, r.signup_promo_code].filter(Boolean).join(' / ');
            return (
              <div key={r.id} style={{ background: '#FFF', border: '1px solid #E8E5EC', borderRadius: 12, padding: '10px 14px' }}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setExpanded(isOpen ? null : r.id);
                    }
                  }}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-plum/40 rounded-lg"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <ModePill mode={r.deletion_mode} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2D2A33' }}>
                    {r.user_email || 'email not captured'}
                  </span>
                  <span style={{ fontSize: 12, color: '#6B6774' }}>{r.household_name || ''}</span>
                  <span style={{ flex: 1 }} />
                  {stayed && <span style={{ fontSize: 12, color: '#6B6774' }}>stayed {stayed}</span>}
                  {source && <span style={{ fontSize: 12, color: '#6B6774' }}>via {source}</span>}
                  <span style={{ fontSize: 12, color: '#8A8493', whiteSpace: 'nowrap' }}>{formatTimestamp(r.deleted_at)}</span>
                </div>
                {isOpen && (
                  <pre style={{ marginTop: 8, padding: 10, background: '#FBF8F3', borderRadius: 8, fontSize: 12, color: '#2D2A33', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(r, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
