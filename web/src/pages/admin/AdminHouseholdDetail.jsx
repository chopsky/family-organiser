import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconArrowLeft } from '../../components/Icons';
import Spinner from '../../components/Spinner';

const avatarColors = {
  red: 'bg-red', 'burnt-orange': 'bg-burnt-orange', amber: 'bg-amber', gold: 'bg-gold',
  leaf: 'bg-leaf', emerald: 'bg-emerald', teal: 'bg-teal', sky: 'bg-sky',
  cobalt: 'bg-cobalt', indigo: 'bg-indigo', purple: 'bg-purple', magenta: 'bg-magenta',
  rose: 'bg-rose', terracotta: 'bg-terracotta', moss: 'bg-moss', slate: 'bg-slate',
  sage: 'bg-sage', plum: 'bg-plum', coral: 'bg-coral',
};

export default function AdminHouseholdDetail() {
  const { id } = useParams();
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadHousehold = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/households/${id}`);
      setHousehold(data);
    } catch (err) {
      console.error('Failed to load household:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadHousehold(); }, [loadHousehold]);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!household) return <p className="text-warm-grey py-10 text-center">Household not found</p>;

  return (
    <div>
      <Link to="/admin/households" className="flex items-center gap-1.5 text-sm font-medium text-warm-grey hover:text-plum transition-colors mb-4">
        <IconArrowLeft className="h-4 w-4" /> Back to Households
      </Link>

      {/* Header Card */}
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <h2 className="font-display text-xl font-bold text-charcoal">{household.name}</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-light-grey">
          <Detail label="Join Code" value={household.join_code} mono />
          <Detail label="Members" value={household.members?.length ?? 0} />
          <Detail label="Timezone" value={household.timezone} />
          <Detail label="Created" value={household.created_at ? new Date(household.created_at).toLocaleDateString() : '—'} />
        </div>
      </div>

      {/* Members */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-semibold text-charcoal mb-3">Members</h3>
        <div className="grid gap-3">
          {(household.members || []).map((m) => {
            const ac = avatarColors[m.color_theme] || avatarColors.sage;
            return (
              <Link
                key={m.id}
                to={`/admin/users/${m.id}`}
                className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-4 flex items-center gap-3 hover:shadow-[var(--shadow-md)] transition-shadow"
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className={`w-10 h-10 rounded-full ${ac} text-white flex items-center justify-center font-bold text-sm`}>
                    {m.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-charcoal text-sm">{m.name}</p>
                  <p className="text-xs text-warm-grey">{m.email || 'No email'}</p>
                </div>
                <div className="flex gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-charcoal text-xs font-semibold capitalize">
                    {m.role}
                  </span>
                  {m.is_platform_admin && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
                      Admin
                    </span>
                  )}
                  {m.disabled_at && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
                      Disabled
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
          {(!household.members || household.members.length === 0) && (
            <p className="text-warm-grey text-sm text-center py-6">No members in this household</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs font-semibold text-warm-grey uppercase tracking-wider">{label}</p>
      <p className={`text-sm text-charcoal mt-0.5 ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}
