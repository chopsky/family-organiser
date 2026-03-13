import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';

export default function Settings() {
  const { household, user, isAdmin, login, token } = useAuth();

  const [name, setName]               = useState(household?.name ?? '');
  const [reminderTime, setReminderTime] = useState(
    household?.reminder_time?.slice(0, 5) ?? '08:00'
  );
  const [saving, setSaving]           = useState(false);
  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => setMembers(data.members ?? []))
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); }, []);

  async function handleRemoveMember(member) {
    if (!window.confirm(`Remove ${member.name} from the household?`)) return;
    try {
      await api.delete(`/household/members/${member.id}`);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove member.');
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!name.trim()) { setError('Household name cannot be empty.'); return; }
    setSaving(true);
    try {
      const { data } = await api.patch('/settings/settings', {
        name: name.trim(),
        reminder_time: reminderTime + ':00',
      });
      setSuccess('Settings saved!');
      // Update stored household
      login({ token, user, household: data.household });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">⚙️ Settings</h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Household card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">🏠 Household</h2>

        {isAdmin ? (
          <form onSubmit={handleSave} className="space-y-4">
            {success && (
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Household name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Daily reminder time</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-gray-400 mt-1">Telegram reminders are sent at this time each day.</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <div className="space-y-2 text-sm text-gray-600">
            <p><span className="font-medium text-gray-700">Name:</span> {household?.name}</p>
            <p><span className="font-medium text-gray-700">Reminder time:</span> {household?.reminder_time?.slice(0, 5)}</p>
            <p className="text-xs text-gray-400 mt-2">Only admins can change household settings.</p>
          </div>
        )}
      </div>

      {/* Join code */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">🔑 Join code</h2>
        <p className="text-sm text-gray-500 mb-3">
          Share this code with family members so they can join your household.
        </p>
        <div className="bg-emerald-50 rounded-lg px-5 py-4 text-center">
          <span className="text-3xl font-mono font-bold tracking-widest text-emerald-700">
            {household?.join_code ?? '—'}
          </span>
        </div>
      </div>

      {/* Members */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">👨‍👩‍👧 Members</h2>
        {loadingMembers ? <Spinner /> : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{m.name}</p>
                  <p className="text-xs text-gray-400">
                    {m.role}
                    {m.telegram_chat_id && ' · 📱 Telegram connected'}
                  </p>
                </div>
                {m.id === user?.id && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">You</span>
                )}
                {isAdmin && m.id !== user?.id && m.role !== 'admin' && (
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Signed in as */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-2">👤 You</h2>
        <p className="text-sm text-gray-600">
          Signed in as <span className="font-medium">{user?.name}</span>
          <span className="text-gray-400"> ({user?.role})</span>
        </p>
      </div>
    </div>
  );
}
