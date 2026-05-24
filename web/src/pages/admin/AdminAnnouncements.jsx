/**
 * AdminAnnouncements - platform admin email broadcaster.
 *
 * Three things on one page:
 *   1. List of recent announcements with their status + counts.
 *   2. Compose form: subject, audience, HTML body. Live preview pane
 *      mirrors the HTML on the right so you can see the rendered email
 *      before committing.
 *   3. "Preview audience" button calls the backend to count the
 *      recipients without committing - lets you check the slice before
 *      hitting Send.
 *
 * Sending is two-step on purpose: Create (resolves audience + writes
 * pending recipient rows) -> Send (actually POSTs each to Postmark).
 * The split lets you abort mid-flow if the audience count looks wrong,
 * and makes retries idempotent (Send only processes rows where
 * sent_at IS NULL).
 *
 * The HTML preview is rendered into a sandboxed iframe via srcdoc
 * rather than dangerouslySetInnerHTML - the admin authors the HTML
 * themselves, but the sandbox is good hygiene and renders the preview
 * closer to how Postmark + a real mail client will display it.
 */

import { useEffect, useState } from 'react';
import api from '../../lib/api';

const AUDIENCES = [
  { value: 'platform_admin', label: 'Platform admins only (test mode)' },
  { value: 'ios_users', label: 'iOS app installs (with verified email)' },
  { value: 'all_verified', label: 'All verified email accounts' },
  { value: 'admins_only', label: 'Household admins only' },
];

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ a }) {
  if (a.sent_completed_at) {
    const bg = a.failure_count > 0 ? '#FBF1DE' : '#EDF5EE';
    const fg = a.failure_count > 0 ? '#8A6A21' : '#3C7842';
    return (
      <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8 }}>
        Sent · {a.success_count}{a.failure_count > 0 ? ` / ${a.failure_count} failed` : ''}
      </span>
    );
  }
  if (a.sent_started_at) {
    return (
      <span style={{ background: '#F1EEF8', color: '#6B3FA0', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8 }}>
        Sending…
      </span>
    );
  }
  return (
    <span style={{ background: '#E8E5EC', color: '#6B6774', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8 }}>
      Draft · {a.recipient_count} recipients
    </span>
  );
}

export default function AdminAnnouncements() {
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');

  const [subject, setSubject] = useState('');
  const [audience, setAudience] = useState('platform_admin');
  const [html, setHtml] = useState('');
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(null);
  const [composeError, setComposeError] = useState('');
  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  async function loadList() {
    try {
      setLoadingList(true);
      const { data } = await api.get('/admin/announcements');
      setList(data.announcements || []);
      setListError('');
    } catch (err) {
      setListError(err.response?.data?.error || 'Failed to load.');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => { loadList(); }, []);

  async function handlePreviewAudience() {
    setPreviewing(true);
    setComposeError('');
    try {
      const { data } = await api.get('/admin/announcements/preview', { params: { audience } });
      setPreviewCount(data);
    } catch (err) {
      setComposeError(err.response?.data?.error || 'Preview failed.');
      setPreviewCount(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCreate() {
    if (!subject.trim()) return setComposeError('Subject is required.');
    if (!html.trim()) return setComposeError('Body HTML is required.');
    setComposeError('');
    setCreating(true);
    try {
      const { data } = await api.post('/admin/announcements', { subject, html, audience });
      await loadList();
      setSubject('');
      setHtml('');
      setPreviewCount(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.alert(`Draft created with ${data.announcement.recipient_count} recipients. Click Send when you're ready.`);
    } catch (err) {
      setComposeError(err.response?.data?.error || 'Create failed.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSend(announcementId, recipientCount) {
    if (!window.confirm(`Send this announcement to ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setSending(announcementId);
    try {
      const { data } = await api.post(`/admin/announcements/${announcementId}/send`);
      await loadList();
      window.alert(`Sent: ${data.sentCount} · Failed: ${data.failedCount}`);
    } catch (err) {
      window.alert(`Send failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold text-charcoal mb-6" style={{ fontFamily: 'var(--font-display)' }}>
        Announcements
      </h1>

      {/* ── Compose ───────────────────────────────────────────────── */}
      <div className="bg-white border border-light-grey rounded-2xl p-5 mb-8">
        <h2 className="text-base font-medium text-charcoal mb-3">New announcement</h2>

        {composeError && (
          <p className="text-sm text-coral mb-3">{composeError}</p>
        )}

        <label className="block text-[13px] font-medium text-charcoal mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Housemait 1.4.0 is out – multi-assignee tasks, school term dates, and more"
          className="w-full mb-4 h-11 border border-light-grey rounded-lg px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
        />

        <label className="block text-[13px] font-medium text-charcoal mb-1">Audience</label>
        <div className="flex items-center gap-3 mb-4">
          <select
            value={audience}
            onChange={(e) => { setAudience(e.target.value); setPreviewCount(null); }}
            className="flex-1 h-11 border border-light-grey rounded-lg px-3 text-sm bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
          >
            {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <button
            type="button"
            onClick={handlePreviewAudience}
            disabled={previewing}
            className="h-11 px-4 rounded-lg border border-light-grey text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            {previewing ? 'Counting…' : 'Preview audience'}
          </button>
        </div>
        {previewCount && (
          <p className="text-sm text-warm-grey mb-4">
            <strong className="text-charcoal">{previewCount.count}</strong> recipient{previewCount.count === 1 ? '' : 's'}.{' '}
            {previewCount.sample.length > 0 && (
              <>Sample: {previewCount.sample.map(s => s.name || s.email).slice(0, 3).join(', ')}{previewCount.sample.length > 3 ? '…' : ''}</>
            )}
          </p>
        )}

        <label className="block text-[13px] font-medium text-charcoal mb-1">
          HTML body
          <span className="ml-2 text-warm-grey text-[11px]">Full HTML – Postmark adds reasonable defaults if you skip the &lt;html&gt;/&lt;body&gt; wrapper.</span>
        </label>
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          rows={14}
          placeholder="<h1>Hi there!</h1>&#10;<p>Housemait just got a major update…</p>"
          className="w-full mb-4 border border-light-grey rounded-lg px-3 py-2 text-sm font-mono bg-white focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
          style={{ minHeight: 200 }}
        />

        {html && (
          <div className="mb-4">
            <p className="text-[13px] font-medium text-charcoal mb-1">Preview</p>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={html}
              className="w-full border border-light-grey rounded-lg bg-white"
              style={{ height: 400 }}
            />
            <p className="text-[11px] text-warm-grey mt-1">Rendered in a sandboxed iframe — scripts and external resources are blocked.</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="bg-plum hover:bg-plum/90 text-white text-sm font-semibold py-2.5 px-5 rounded-lg disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create draft'}
        </button>
      </div>

      {/* ── List of recent announcements ─────────────────────────── */}
      <h2 className="text-base font-medium text-charcoal mb-3">Recent announcements</h2>
      {loadingList && <p className="text-sm text-warm-grey">Loading…</p>}
      {listError && <p className="text-sm text-coral">{listError}</p>}
      {!loadingList && !listError && list.length === 0 && (
        <p className="text-sm text-warm-grey">No announcements yet.</p>
      )}
      {!loadingList && list.map((a) => {
        const audienceLabel = AUDIENCES.find(x => x.value === a.audience)?.label || a.audience;
        const isPendingSend = !a.sent_completed_at;
        return (
          <div key={a.id} className="bg-white border border-light-grey rounded-2xl p-4 mb-3">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-sm font-semibold text-charcoal flex-1 min-w-0 truncate">{a.subject}</h3>
              <StatusBadge a={a} />
            </div>
            <p className="text-xs text-warm-grey mb-2">
              {audienceLabel} · created {formatTimestamp(a.created_at)}
              {a.sent_completed_at && ` · sent ${formatTimestamp(a.sent_completed_at)}`}
            </p>
            {isPendingSend && a.recipient_count > 0 && (
              <button
                type="button"
                onClick={() => handleSend(a.id, a.recipient_count)}
                disabled={sending === a.id}
                className="bg-coral hover:bg-coral/90 text-white text-xs font-semibold py-1.5 px-3 rounded-md disabled:opacity-50"
              >
                {sending === a.id ? 'Sending…' : `Send to ${a.recipient_count}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
