import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { IconArrowLeft, IconShield, IconBan, IconCheckCircle, IconTrash, IconCpu, IconMessageCircle } from '../../components/Icons';
import Spinner from '../../components/Spinner';

const avatarColors = {
  red: 'bg-red', 'burnt-orange': 'bg-burnt-orange', amber: 'bg-amber', gold: 'bg-gold',
  leaf: 'bg-leaf', emerald: 'bg-emerald', teal: 'bg-teal', sky: 'bg-sky',
  cobalt: 'bg-cobalt', indigo: 'bg-indigo', purple: 'bg-purple', magenta: 'bg-magenta',
  rose: 'bg-rose', terracotta: 'bg-terracotta', moss: 'bg-moss', slate: 'bg-slate',
  sage: 'bg-sage', plum: 'bg-plum', coral: 'bg-coral',
};

export default function AdminUserDetail() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/users/${id}`);
      setUser(data);
    } catch (err) {
      console.error('Failed to load user:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadUser(); }, [loadUser]);

  useEffect(() => {
    api.get(`/admin/users/${id}/usage`)
      .then(({ data }) => setUsage(data))
      .catch((err) => console.error('Failed to load usage:', err))
      .finally(() => setUsageLoading(false));
  }, [id]);

  const isSelf = currentUser?.id === id;

  async function toggleDisable() {
    if (isSelf || actionLoading) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/users/${id}`, { disabled: !user.disabled_at });
      await loadUser();
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setActionLoading(false);
    }
  }

  async function togglePlatformAdmin() {
    if (isSelf || actionLoading) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/users/${id}`, { is_platform_admin: !user.is_platform_admin });
      await loadUser();
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (isSelf || actionLoading) return;
    setActionLoading(true);
    try {
      await api.delete(`/admin/users/${id}?confirm=true`);
      navigate('/admin/users');
    } catch (err) {
      console.error('Failed to delete user:', err);
      setActionLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!user) return <p className="text-warm-grey py-10 text-center">User not found</p>;

  const ac = avatarColors[user.color_theme] || avatarColors.sage;

  return (
    <div>
      <Link to="/admin/users" className="flex items-center gap-1.5 text-sm font-medium text-warm-grey hover:text-plum transition-colors mb-4">
        <IconArrowLeft className="h-4 w-4" /> Back to Users
      </Link>

      {/* Profile Card */}
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <div className="flex items-start gap-4">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.name} className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className={`w-16 h-16 rounded-full ${ac} text-white flex items-center justify-center text-xl font-bold`}>
              {user.name?.[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-bold text-charcoal">{user.name}</h2>
            <p className="text-warm-grey text-sm">{user.email || 'No email'}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-charcoal text-xs font-semibold capitalize">
                {user.role}
              </span>
              {user.is_platform_admin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
                  Platform Admin
                </span>
              )}
              {user.disabled_at && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
                  Disabled
                </span>
              )}
              {user.email_verified && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold">
                  Verified
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-light-grey">
          <Detail label="Member Type" value={user.member_type} />
          <Detail label="Family Role" value={user.family_role} />
          <Detail label="WhatsApp" value={user.whatsapp_linked ? user.whatsapp_phone : 'Not linked'} />
          <Detail label="Timezone" value={user.timezone} />
          <Detail label="Joined" value={user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'} />
          <Detail label="Color Theme" value={user.color_theme} />
        </div>

        {/* Household info */}
        {user.household && (
          <div className="mt-6 pt-6 border-t border-light-grey">
            <h3 className="text-sm font-semibold text-charcoal mb-2">Household</h3>
            <Link
              to={`/admin/households/${user.household.id}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-cream rounded-xl text-sm font-medium text-charcoal hover:bg-plum-light hover:text-plum transition-colors"
            >
              {user.household.name}
              <span className="text-xs text-warm-grey">({user.household.join_code})</span>
            </Link>
          </div>
        )}

        {/* Actions */}
        {!isSelf && (
          <div className="mt-6 pt-6 border-t border-light-grey flex flex-wrap gap-3">
            <button
              onClick={togglePlatformAdmin}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-[1.5px] border-plum text-plum text-sm font-semibold hover:bg-plum-light transition-colors disabled:opacity-50"
            >
              <IconShield className="h-4 w-4" />
              {user.is_platform_admin ? 'Remove Admin' : 'Make Admin'}
            </button>
            <button
              onClick={toggleDisable}
              disabled={actionLoading}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                user.disabled_at
                  ? 'border-[1.5px] border-sage text-sage hover:bg-sage-light'
                  : 'border-[1.5px] border-coral text-coral hover:bg-coral-light'
              }`}
            >
              {user.disabled_at ? <><IconCheckCircle className="h-4 w-4" /> Enable</> : <><IconBan className="h-4 w-4" /> Disable</>}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-coral text-white text-sm font-semibold hover:bg-coral/90 transition-colors disabled:opacity-50"
            >
              <IconTrash className="h-4 w-4" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
            <h3 className="font-display text-lg font-bold text-charcoal">Delete User</h3>
            <p className="text-sm text-warm-grey mt-2">
              Are you sure you want to permanently delete <strong>{user.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-light-grey text-sm font-semibold text-charcoal hover:bg-cream transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-coral text-white text-sm font-semibold hover:bg-coral/90 transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Usage Stats */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* AI Usage */}
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <IconCpu className="h-5 w-5 text-plum" />
            <h3 className="font-display text-base font-semibold text-charcoal">AI Usage (30d)</h3>
          </div>
          {usageLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : !usage?.ai?.totalCalls ? (
            <p className="text-sm text-warm-grey">No AI calls recorded</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.ai.totalCalls}</p>
                  <p className="text-[11px] text-warm-grey">Total Calls</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.ai.avgLatencyMs}ms</p>
                  <p className="text-[11px] text-warm-grey">Avg Latency</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.ai.failoverCalls}</p>
                  <p className="text-[11px] text-warm-grey">Failovers</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {Object.entries(usage.ai.byProvider || {}).map(([provider, count]) => (
                  <div key={provider} className="flex items-center justify-between text-sm">
                    <span className="text-warm-grey capitalize">{provider}</span>
                    <span className="font-medium text-charcoal">{count}</span>
                  </div>
                ))}
              </div>
              {Object.keys(usage.ai.byFeature || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-light-grey space-y-1.5">
                  {Object.entries(usage.ai.byFeature).sort((a, b) => b[1] - a[1]).map(([feature, count]) => (
                    <div key={feature} className="flex items-center justify-between text-sm">
                      <span className="text-warm-grey capitalize">{feature}</span>
                      <span className="font-medium text-charcoal">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* WhatsApp Usage */}
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <IconMessageCircle className="h-5 w-5 text-plum" />
            <h3 className="font-display text-base font-semibold text-charcoal">WhatsApp (30d)</h3>
          </div>
          {usageLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : !usage?.whatsapp?.totalMessages ? (
            <p className="text-sm text-warm-grey">No WhatsApp messages recorded</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.whatsapp.totalMessages}</p>
                  <p className="text-[11px] text-warm-grey">Total</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.whatsapp.inbound}</p>
                  <p className="text-[11px] text-warm-grey">Inbound</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-charcoal">{usage.whatsapp.errors}</p>
                  <p className="text-[11px] text-warm-grey">Errors</p>
                </div>
              </div>
              {Object.keys(usage.whatsapp.byType || {}).length > 0 && (
                <div className="space-y-1.5">
                  {Object.entries(usage.whatsapp.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between text-sm">
                      <span className="text-warm-grey capitalize">{type}</span>
                      <span className="font-medium text-charcoal">{count}</span>
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(usage.whatsapp.byIntent || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-light-grey space-y-1.5">
                  {Object.entries(usage.whatsapp.byIntent).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                    <div key={intent} className="flex items-center justify-between text-sm">
                      <span className="text-warm-grey capitalize">{intent.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-charcoal">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-warm-grey uppercase tracking-wider">{label}</p>
      <p className="text-sm text-charcoal mt-0.5 capitalize">{value || '—'}</p>
    </div>
  );
}
