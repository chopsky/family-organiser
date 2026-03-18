import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconUsers, IconHome, IconMail } from '../components/Icons';

export default function FamilySetup() {
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

  // Invite / add member state
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newBirthday, setNewBirthday] = useState('');
  const [newColor, setNewColor] = useState('sage');
  const [newEmail, setNewEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Add dependent state
  const [showAddDependent, setShowAddDependent] = useState(false);
  const [depName, setDepName] = useState('');
  const [depRole, setDepRole] = useState('');
  const [depBirthday, setDepBirthday] = useState('');
  const [depColor, setDepColor] = useState('sage');
  const [addingDependent, setAddingDependent] = useState(false);

  // Edit profile state
  const [editingMember, setEditingMember] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileColor, setProfileColor] = useState('sage');
  const [profileReminderTime, setProfileReminderTime] = useState('');
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => setMembers(data.members ?? []))
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); }, []);

  useEffect(() => {
    if (isAdmin) {
      api.get('/household/invites')
        .then(({ data }) => setPendingInvites(data.invites ?? []))
        .catch(() => {});
    }
  }, [isAdmin]);

  function openAddDependent() {
    setDepName('');
    setDepRole('');
    setDepBirthday('');
    setDepColor('sage');
    setShowAddDependent(true);
  }

  async function handleAddDependent() {
    if (!depName.trim()) { setError('Name is required.'); return; }
    setAddingDependent(true);
    setError('');
    try {
      await api.post('/household/dependents', {
        name: depName.trim(),
        family_role: depRole.trim() || null,
        birthday: depBirthday || null,
        color_theme: depColor,
      });
      setShowAddDependent(false);
      await loadMembers();
      setSuccess('Member added!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add member.');
    } finally {
      setAddingDependent(false);
    }
  }

  async function handleRemoveDependent(member) {
    if (!window.confirm(`Remove ${member.name}?`)) return;
    try {
      await api.delete(`/household/dependents/${member.id}`);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove member.');
    }
  }

  function openEditProfile(member) {
    setEditingMember(member);
    setProfileName(member.name || '');
    setProfileRole(member.family_role || '');
    setProfileBirthday(member.birthday || '');
    setProfileColor(member.color_theme || 'sage');
    setProfileReminderTime(member.reminder_time ? member.reminder_time.substring(0, 5) : '');
    setProfileAvatar(member.avatar_url || null);
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await api.post('/household/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfileAvatar(data.avatar_url);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: data.avatar_url }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
    try {
      await api.delete('/household/profile/avatar');
      setProfileAvatar(null);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: null }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  const [profileError, setProfileError] = useState('');

  async function handleSaveProfile() {
    if (!profileName.trim()) { setProfileError('Name is required.'); return; }
    setProfileError('');
    setSavingProfile(true);
    // Capture target member ID immediately (before any async/state changes)
    const targetId = editingMember?.id;
    const isEditingSelf = !targetId || targetId === user?.id;
    try {
      const payload = {
        name: profileName.trim(),
        family_role: profileRole.trim(),
        birthday: profileBirthday || null,
        color_theme: profileColor,
        reminder_time: profileReminderTime || null,
      };
      // When admin edits another member, include target user_id
      if (!isEditingSelf) {
        payload.user_id = targetId;
      }
      await api.patch('/household/profile', payload);
      await loadMembers();
      // Only update auth context if editing own profile
      if (isEditingSelf) {
        const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor };
        login({ token, user: updatedUser, household });
      }
      setEditingMember(null);
      setSuccess('Profile updated!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  }

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
      login({ token, user, household: data.household });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  function openAddMember() {
    setNewName('');
    setNewRole('');
    setNewBirthday('');
    setNewColor('sage');
    setNewEmail('');
    setShowAddMember(true);
  }

  async function handleAddMember() {
    if (!newName.trim()) { setError('Name is required.'); return; }
    if (!newEmail.trim()) { setError('Email is required to send the invite.'); return; }
    setAddingMember(true);
    setError('');
    try {
      await api.post('/household/invite', {
        email: newEmail.trim(),
        name: newName.trim(),
        family_role: newRole.trim() || null,
        birthday: newBirthday || null,
        color_theme: newColor,
      });
      setShowAddMember(false);
      setSuccess(`Invite sent to ${newEmail.trim()}`);
      setTimeout(() => setSuccess(''), 3000);
      const { data } = await api.get('/household/invites');
      setPendingInvites(data.invites ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send invite.');
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-bark flex items-center gap-2"><IconUsers className="h-6 w-6" /> Family Setup</h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Household card */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-4 flex items-center gap-2"><IconHome className="h-4 w-4" /> Household</h2>

        {isAdmin ? (
          <form onSubmit={handleSave} className="space-y-4">
            {success && (
              <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">{success}</p>
            )}
            <div>
              <label className="text-sm font-medium text-bark block mb-1">Household name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-bark block mb-1">Default daily reminder time</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-cocoa mt-1">Default for members who haven't set their own time.</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <div className="space-y-2 text-sm text-cocoa">
            <p><span className="font-medium text-bark">Name:</span> {household?.name}</p>
            <p><span className="font-medium text-bark">Reminder time:</span> {household?.reminder_time?.slice(0, 5)}</p>
            <p className="text-xs text-cocoa mt-2">Only admins can change household settings.</p>
          </div>
        )}
      </div>

      {/* Members */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconUsers className="h-4 w-4" /> Family Members</h2>
        {loadingMembers ? <Spinner /> : (
          <ul className="space-y-2">
            {members.filter(m => m.member_type !== 'dependent').map((m) => {
              const avatarColors = {
                sage: 'bg-sage text-white',
                plum: 'bg-plum text-white',
                coral: 'bg-coral text-white',
                amber: 'bg-amber text-white',
                sky: 'bg-sky text-white',
                rose: 'bg-rose text-white',
                teal: 'bg-teal text-white',
                lavender: 'bg-lavender text-white',
                terracotta: 'bg-terracotta text-white',
                slate: 'bg-slate text-white',
              };
              const avatarClass = avatarColors[m.color_theme] || avatarColors.sage;
              return (
              <li key={m.id} className="flex items-center gap-3">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className={`w-9 h-9 rounded-full ${avatarClass} flex items-center justify-center font-bold text-sm shrink-0`}>
                    {m.name[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-bark">{m.name}</p>
                  <p className="text-xs text-cocoa">
                    {m.family_role ? `${m.family_role} · ` : ''}{m.role}
                    {m.whatsapp_linked && ' · WhatsApp connected'}
                  </p>
                </div>
                {(m.id === user?.id || isAdmin) && (
                  <button
                    onClick={() => openEditProfile(m)}
                    className="text-cocoa hover:text-primary p-1.5 rounded-lg transition-colors hover:bg-primary/10"
                    title="Edit profile"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                )}
                {isAdmin && m.id !== user?.id && m.role !== 'admin' && (
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="text-error/60 hover:text-error p-1.5 rounded-lg transition-colors hover:bg-error/10"
                    title="Remove member"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </li>
              );
            })}
          </ul>
        )}

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <div className="mt-4 pt-4 border-t border-cream-border">
            <p className="text-xs font-medium text-cocoa uppercase tracking-wider mb-2">Pending invites</p>
            <ul className="space-y-1">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between text-sm text-cocoa bg-oat rounded-xl px-3 py-2">
                  <span>{inv.name || inv.email}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cocoa">
                      {inv.name ? inv.email : ''} · expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await api.delete(`/household/invites/${inv.id}`);
                          setPendingInvites(prev => prev.filter(i => i.id !== inv.id));
                        } catch {
                          setError('Failed to cancel invite.');
                        }
                      }}
                      className="text-xs text-error hover:text-error/80 transition-colors"
                      title="Cancel invite"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Add new member button */}
        {isAdmin && (
          <button
            onClick={openAddMember}
            className="mt-4 w-full border-2 border-dashed border-cream-border text-cocoa hover:border-primary hover:text-primary font-medium py-3 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add new member
          </button>
        )}
      </div>

      {/* Other Family Members (dependents) */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconUsers className="h-4 w-4" /> Other Family Members</h2>
        <p className="text-xs text-cocoa mb-3">Family members who don't need their own account (e.g. infants, young children, pets). They can be assigned tasks and events.</p>
        {loadingMembers ? <Spinner /> : (
          <>
            {members.filter(m => m.member_type === 'dependent').length > 0 ? (
              <ul className="space-y-2">
                {members.filter(m => m.member_type === 'dependent').map((m) => {
                  const avatarColors = {
                    sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white',
                    amber: 'bg-amber text-white', sky: 'bg-sky text-white', rose: 'bg-rose text-white',
                    teal: 'bg-teal text-white', lavender: 'bg-lavender text-white',
                    terracotta: 'bg-terracotta text-white', slate: 'bg-slate text-white',
                  };
                  const avatarClass = avatarColors[m.color_theme] || avatarColors.sage;
                  return (
                    <li key={m.id} className="flex items-center gap-3">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt={m.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className={`w-9 h-9 rounded-full ${avatarClass} flex items-center justify-center font-bold text-sm shrink-0`}>
                          {m.name[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-bark">{m.name}</p>
                        {m.family_role && <p className="text-xs text-cocoa">{m.family_role}</p>}
                      </div>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => openEditProfile(m)}
                            className="text-cocoa hover:text-primary p-1.5 rounded-lg transition-colors hover:bg-primary/10"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleRemoveDependent(m)}
                            className="text-error/60 hover:text-error p-1.5 rounded-lg transition-colors hover:bg-error/10"
                            title="Remove"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-cocoa">No other family members added yet.</p>
            )}
            {isAdmin && (
              <button
                onClick={openAddDependent}
                className="mt-4 w-full border-2 border-dashed border-cream-border text-cocoa hover:border-primary hover:text-primary font-medium py-3 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add family member
              </button>
            )}
          </>
        )}
      </div>

      {/* Add Dependent Modal */}
      {showAddDependent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddDependent(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-bark">Add family member</h2>
              <button onClick={() => setShowAddDependent(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-center">
                <div className={`w-16 h-16 rounded-full ${
                  { sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white', amber: 'bg-amber text-white', sky: 'bg-sky text-white', rose: 'bg-rose text-white', teal: 'bg-teal text-white', lavender: 'bg-lavender text-white', terracotta: 'bg-terracotta text-white', slate: 'bg-slate text-white' }[depColor] || 'bg-sage text-white'
                } flex items-center justify-center font-bold text-xl`}>
                  {depName?.[0]?.toUpperCase() || '?'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input type="text" value={depName} onChange={(e) => setDepName(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="e.g. Luna, Baby Oliver" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Role</label>
                <input type="text" value={depRole} onChange={(e) => setDepRole(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="e.g. Baby, Dog, Toddler" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
                <input type="date" value={depBirthday} onChange={(e) => setDepBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { key: 'sage', bg: 'bg-sage', ring: 'ring-sage' }, { key: 'plum', bg: 'bg-plum', ring: 'ring-plum' },
                    { key: 'coral', bg: 'bg-coral', ring: 'ring-coral' }, { key: 'amber', bg: 'bg-amber', ring: 'ring-amber' },
                    { key: 'sky', bg: 'bg-sky', ring: 'ring-sky' }, { key: 'rose', bg: 'bg-rose', ring: 'ring-rose' },
                    { key: 'teal', bg: 'bg-teal', ring: 'ring-teal' },
                    { key: 'terracotta', bg: 'bg-terracotta', ring: 'ring-terracotta' }, { key: 'slate', bg: 'bg-slate', ring: 'ring-slate' },
                  ].map(({ key, bg, ring }) => (
                    <button key={key} type="button" onClick={() => setDepColor(key)}
                      className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center transition-all ${depColor === key ? `ring-2 ${ring} ring-offset-2` : 'hover:scale-110'}`}
                      title={key.charAt(0).toUpperCase() + key.slice(1)}
                    >
                      {depColor === key && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddDependent(false)} className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors">Cancel</button>
              <button onClick={handleAddDependent} disabled={addingDependent} className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors">
                {addingDependent ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddMember(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-bark">Add new member</h2>
              <button onClick={() => setShowAddMember(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Preview avatar */}
              <div className="flex justify-center">
                <div className={`w-16 h-16 rounded-full ${
                  { sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white', amber: 'bg-amber text-white', sky: 'bg-sky text-white', rose: 'bg-rose text-white', teal: 'bg-teal text-white', lavender: 'bg-lavender text-white', terracotta: 'bg-terracotta text-white', slate: 'bg-slate text-white' }[newColor] || 'bg-sage text-white'
                } flex items-center justify-center font-bold text-xl`}>
                  {newName?.[0]?.toUpperCase() || '?'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="Their name" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Family role</label>
                <input type="text" value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="e.g. Mother, Son, Grandmother" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
                <input type="date" value={newBirthday} onChange={(e) => setNewBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { key: 'sage',       bg: 'bg-sage',       ring: 'ring-sage' },
                    { key: 'plum',       bg: 'bg-plum',       ring: 'ring-plum' },
                    { key: 'coral',      bg: 'bg-coral',      ring: 'ring-coral' },
                    { key: 'amber',      bg: 'bg-amber',      ring: 'ring-amber' },
                    { key: 'sky',        bg: 'bg-sky',        ring: 'ring-sky' },
                    { key: 'rose',       bg: 'bg-rose',       ring: 'ring-rose' },
                    { key: 'teal',       bg: 'bg-teal',       ring: 'ring-teal' },
                    { key: 'terracotta', bg: 'bg-terracotta', ring: 'ring-terracotta' },
                    { key: 'slate',      bg: 'bg-slate',      ring: 'ring-slate' },
                  ].map(({ key, bg, ring }) => (
                    <button key={key} type="button" onClick={() => setNewColor(key)}
                      className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center transition-all ${newColor === key ? `ring-2 ${ring} ring-offset-2` : 'hover:scale-110'}`}
                      title={key.charAt(0).toUpperCase() + key.slice(1)}
                    >
                      {newColor === key && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-cream-border">
                <label className="block text-sm font-medium text-bark mb-1">Email address <span className="text-error">*</span></label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="Their email address" />
                <p className="text-xs text-cocoa mt-1">An invite will be sent to this email address.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddMember(false)} className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors">
                Cancel
              </button>
              <button onClick={handleAddMember} disabled={addingMember} className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors">
                {addingMember ? 'Sending invite…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingMember(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-bark">{editingMember?.id === user?.id ? 'Edit profile' : `Edit ${editingMember?.name}`}</h2>
              <button onClick={() => { setEditingMember(null); setProfileError(''); }} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {profileError && (
              <p className="text-sm text-error bg-error/10 rounded-xl px-3 py-2 mb-2">{profileError}</p>
            )}

            <div className="space-y-4">
              {/* Avatar upload */}
              <div className="flex flex-col items-center gap-2">
                {profileAvatar ? (
                  <img src={profileAvatar} alt={profileName} className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className={`w-20 h-20 rounded-full ${
                    { sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white', amber: 'bg-amber text-white', sky: 'bg-sky text-white', rose: 'bg-rose text-white', teal: 'bg-teal text-white', lavender: 'bg-lavender text-white', terracotta: 'bg-terracotta text-white', slate: 'bg-slate text-white' }[profileColor] || 'bg-sage text-white'
                  } flex items-center justify-center font-bold text-2xl`}>
                    {profileName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className={`text-sm font-medium cursor-pointer ${uploadingAvatar ? 'text-cocoa' : 'text-primary hover:text-primary-pressed'} transition-colors`}>
                    {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      disabled={uploadingAvatar}
                      className="hidden"
                    />
                  </label>
                  {profileAvatar && (
                    <button
                      type="button"
                      onClick={handleAvatarRemove}
                      disabled={uploadingAvatar}
                      className="text-sm text-error hover:text-error/80 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Family role</label>
                <input
                  type="text"
                  value={profileRole}
                  onChange={(e) => setProfileRole(e.target.value)}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  placeholder="e.g. Father, Mother, Daughter"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
                <input
                  type="date"
                  value={profileBirthday}
                  onChange={(e) => setProfileBirthday(e.target.value)}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Color theme</label>
                <div className="flex gap-3">
                  {[
                    { key: 'sage',       bg: 'bg-sage',       ring: 'ring-sage' },
                    { key: 'plum',       bg: 'bg-plum',       ring: 'ring-plum' },
                    { key: 'coral',      bg: 'bg-coral',      ring: 'ring-coral' },
                    { key: 'amber',      bg: 'bg-amber',      ring: 'ring-amber' },
                    { key: 'sky',        bg: 'bg-sky',        ring: 'ring-sky' },
                    { key: 'rose',       bg: 'bg-rose',       ring: 'ring-rose' },
                    { key: 'teal',       bg: 'bg-teal',       ring: 'ring-teal' },
                    { key: 'terracotta', bg: 'bg-terracotta', ring: 'ring-terracotta' },
                    { key: 'slate',      bg: 'bg-slate',      ring: 'ring-slate' },
                  ].map(({ key, bg, ring }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setProfileColor(key)}
                      className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center transition-all ${
                        profileColor === key ? `ring-2 ${ring} ring-offset-2` : 'hover:scale-110'
                      }`}
                      title={key.charAt(0).toUpperCase() + key.slice(1)}
                    >
                      {profileColor === key && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {editingMember?.member_type !== 'dependent' && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1">Daily reminder time</label>
                  <input
                    type="time"
                    value={profileReminderTime}
                    onChange={(e) => setProfileReminderTime(e.target.value)}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  />
                  <p className="text-xs text-cocoa mt-1">
                    {profileReminderTime ? 'Your personal reminder time.' : `Using household default (${household?.reminder_time?.slice(0, 5) || '08:00'}).`}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingMember(null)}
                className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors"
              >
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
