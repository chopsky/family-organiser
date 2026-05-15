/**
 * AdminInboundEmails — observability for forwarded-email processing.
 *
 * Lists the most recent ~100 forwarded emails the inbound webhook
 * handled, with status, AI classification, and per-action counts.
 * Without this page we'd be blind to failure modes — the only signal
 * for AI mistakes was a user complaining. Now you can scan a day's
 * worth of forwarded emails and spot patterns (e.g. "all Stripe
 * receipts are mis-extracted as shopping items").
 *
 * Each row is expandable to show:
 *   • the AI's actions_taken JSON (IDs of checked-off / added /
 *     created rows) — useful for understanding what got changed.
 *   • undone_at timestamp — see how often users hit UNDO.
 *
 * No edits / actions from this page. It's read-only diagnostics.
 */

import { useEffect, useState } from 'react';
import api from '../../lib/api';

const STATUS_STYLES = {
  completed: { bg: '#EDF5EE', fg: '#3C7842', label: 'Completed' },
  processing: { bg: '#FBF1DE', fg: '#8A6A21', label: 'Processing' },
  failed:    { bg: '#FDF0EB', fg: '#B14828', label: 'Failed' },
  received:  { bg: '#F1EEF8', fg: '#6B3FA0', label: 'Received' },
};

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || { bg: '#E8E5EC', fg: '#6B6774', label: status || 'Unknown' };
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminInboundEmails() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    api.get('/admin/inbound-emails', { params: { limit: 100 } })
      .then(({ data }) => setEmails(data.emails || []))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-warm-grey p-6">Loading…</p>;
  if (error) return <p className="text-sm text-coral p-6">{error}</p>;

  const undoneCount = emails.filter((e) => e.undone_at).length;
  const failedCount = emails.filter((e) => e.status === 'failed').length;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-normal text-charcoal mb-2" style={{ fontFamily: '"Circular Std", Georgia, serif' }}>
        Inbound emails
      </h1>
      <p className="text-sm text-warm-grey mb-6">
        Last 100 forwarded emails processed by the AI pipeline.
        {failedCount > 0 && ` ${failedCount} failed.`}
        {undoneCount > 0 && ` ${undoneCount} were undone by the user.`}
      </p>

      <div className="bg-white rounded-2xl border border-light-grey overflow-hidden" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
        <table className="w-full text-sm">
          <thead className="bg-cream border-b border-light-grey">
            <tr className="text-left text-xs text-warm-grey uppercase tracking-wide">
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Household</th>
              <th className="px-4 py-3 font-semibold">From</th>
              <th className="px-4 py-3 font-semibold">Subject</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
              <th className="px-4 py-3 font-semibold">Undo</th>
            </tr>
          </thead>
          <tbody>
            {emails.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-warm-grey">
                  No inbound emails yet.
                </td>
              </tr>
            )}
            {emails.map((row) => {
              const a = row.actions_taken || {};
              const counts = {
                checked: (a.checked_off || []).length,
                added: (a.added_items || []).length,
                events: (a.events || []).length,
                tasks: (a.tasks || []).length,
              };
              const total = counts.checked + counts.added + counts.events + counts.tasks;
              const expanded = expandedId === row.id;
              return (
                <>
                  <tr key={row.id} className="border-b border-light-grey hover:bg-cream/30 cursor-pointer" onClick={() => setExpandedId(expanded ? null : row.id)}>
                    <td className="px-4 py-3 text-xs text-warm-grey whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                    <td className="px-4 py-3 text-charcoal whitespace-nowrap">{row.household_name || row.household_id}</td>
                    <td className="px-4 py-3 text-charcoal text-xs truncate" style={{ maxWidth: 200 }}>{row.from_email}</td>
                    <td className="px-4 py-3 text-charcoal text-xs truncate" style={{ maxWidth: 300 }}>{row.subject || '(no subject)'}</td>
                    <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-4 py-3 text-right text-xs text-warm-grey whitespace-nowrap">
                      {total === 0 ? '—' : [
                        counts.checked && `${counts.checked} ✓`,
                        counts.added && `${counts.added} +`,
                        counts.events && `${counts.events} 📅`,
                        counts.tasks && `${counts.tasks} ☑`,
                      ].filter(Boolean).join(' · ')}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.undone_at ? <span className="text-coral font-medium">Undone</span> : '—'}
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={7} className="px-4 py-4 bg-cream/40 border-b border-light-grey">
                        <div className="text-xs text-charcoal space-y-2">
                          {row.error_message && (
                            <div>
                              <span className="font-semibold text-coral">Error: </span>
                              <span className="font-mono whitespace-pre-wrap">{row.error_message}</span>
                            </div>
                          )}
                          {a.checked_off_names?.length > 0 && (
                            <div>
                              <span className="font-semibold">Checked off: </span>
                              {a.checked_off_names.join(', ')}
                            </div>
                          )}
                          {a.added_item_names?.length > 0 && (
                            <div>
                              <span className="font-semibold">Added to history: </span>
                              {a.added_item_names.join(', ')}
                            </div>
                          )}
                          {a.event_titles?.length > 0 && (
                            <div>
                              <span className="font-semibold">Events: </span>
                              {a.event_titles.join(', ')}
                            </div>
                          )}
                          {a.task_titles?.length > 0 && (
                            <div>
                              <span className="font-semibold">Tasks: </span>
                              {a.task_titles.join(', ')}
                            </div>
                          )}
                          {row.undone_at && (
                            <div className="text-coral">
                              <span className="font-semibold">Undone at: </span>
                              {formatTimestamp(row.undone_at)}
                            </div>
                          )}
                          {!row.error_message && !a.checked_off_names?.length && !a.added_item_names?.length && !a.event_titles?.length && !a.task_titles?.length && (
                            <div className="text-warm-grey">No actions taken.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
