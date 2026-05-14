import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconUsers, IconHome, IconMail } from '../components/Icons';
import { useCanWrite } from '../context/SubscriptionContext';
import { isUkHousehold, isSouthAfricaHousehold, hasSchoolsFeature } from '../lib/country';
import SubscribePrompt from '../components/SubscribePrompt';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const COLOUR_OPTIONS = [
  { key: 'red',           bg: 'bg-red',           ring: 'ring-red' },
  { key: 'burnt-orange',  bg: 'bg-burnt-orange',  ring: 'ring-burnt-orange' },
  { key: 'amber',         bg: 'bg-amber',         ring: 'ring-amber' },
  { key: 'gold',          bg: 'bg-gold',          ring: 'ring-gold' },
  { key: 'leaf',          bg: 'bg-leaf',           ring: 'ring-leaf' },
  { key: 'emerald',       bg: 'bg-emerald',       ring: 'ring-emerald' },
  { key: 'teal',          bg: 'bg-teal',          ring: 'ring-teal' },
  { key: 'sky',           bg: 'bg-sky',           ring: 'ring-sky' },
  { key: 'cobalt',        bg: 'bg-cobalt',        ring: 'ring-cobalt' },
  { key: 'indigo',        bg: 'bg-indigo',        ring: 'ring-indigo' },
  { key: 'purple',        bg: 'bg-purple',        ring: 'ring-purple' },
  { key: 'magenta',       bg: 'bg-magenta',       ring: 'ring-magenta' },
  { key: 'rose',          bg: 'bg-rose',          ring: 'ring-rose' },
  { key: 'terracotta',    bg: 'bg-terracotta',    ring: 'ring-terracotta' },
  { key: 'moss',          bg: 'bg-moss',          ring: 'ring-moss' },
  { key: 'slate',         bg: 'bg-slate',         ring: 'ring-slate' },
];

const AVATAR_COLOURS = {
  red: 'bg-red text-white',
  'burnt-orange': 'bg-burnt-orange text-white',
  amber: 'bg-amber text-white',
  gold: 'bg-gold text-white',
  leaf: 'bg-leaf text-white',
  emerald: 'bg-emerald text-white',
  teal: 'bg-teal text-white',
  sky: 'bg-sky text-white',
  cobalt: 'bg-cobalt text-white',
  indigo: 'bg-indigo text-white',
  purple: 'bg-purple text-white',
  magenta: 'bg-magenta text-white',
  rose: 'bg-rose text-white',
  terracotta: 'bg-terracotta text-white',
  moss: 'bg-moss text-white',
  slate: 'bg-slate text-white',
  // Legacy fallbacks
  sage: 'bg-sage text-white',
  plum: 'bg-plum text-white',
  coral: 'bg-coral text-white',
  lavender: 'bg-indigo text-white',
};

export default function FamilySetup() {
  const { household, user, isAdmin, login, token } = useAuth();
  const canWrite = useCanWrite();
  // Country-specific school flow gates. There are now three flows:
  //   • UK: GIAS-driven school search + LA term-date scrape (full-fat)
  //   • SA: free-text school name + national term-date import (1.3.0+)
  //   • Other: schools feature hidden entirely with a Coming-soon card
  const isUk = isUkHousehold(household);
  const isSa = isSouthAfricaHousehold(household);
  const showSchools = hasSchoolsFeature(household);

  const [name, setName]               = useState(household?.name ?? '');
  // Household default reminder time. Previously editable on this page but
  // removed from the UI now that each member sets their own time — the
  // column is kept as the scheduler's fallback for users who haven't set a
  // personal time. The seed value (set on signup) remains in the DB and is
  // never re-edited from the client. Read here only to display in the
  // per-member hint copy.
  const householdReminderTime = household?.reminder_time?.slice(0, 5) ?? '08:00';
  const [saving, setSaving]           = useState(false);
  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');
  const [householdAllergies, setHouseholdAllergies] = useState(() => {
    try { return JSON.parse(household?.allergies || '[]'); } catch { return []; }
  });
  const [savingAllergies, setSavingAllergies] = useState(false);

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Invite / add member state
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newBirthday, setNewBirthday] = useState('');
  const [newColor, setNewColor] = useState('teal');
  const [newEmail, setNewEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  // Invite-flow school state. Mirrors the depAttendsSchool/depSchool*
  // pattern but kept as a separate set of state vars so the two modals
  // can't leak into each other.
  const [newAttendsSchool, setNewAttendsSchool] = useState(false);
  const [newSchoolSearch, setNewSchoolSearch] = useState('');
  const [newSchoolResults, setNewSchoolResults] = useState([]);
  const [newSelectedSchool, setNewSelectedSchool] = useState(null);
  const [searchingNewSchools, setSearchingNewSchools] = useState(false);
  // SA path for the invite-member modal: free-text school name plus an
  // optional pointer to an already-linked household school (when the
  // user clicks a chip to reuse a sibling's school). When existingId is
  // set, the handler links to that row without creating a new one.
  const [newSaSchoolName, setNewSaSchoolName] = useState('');
  const [newSaSchoolExistingId, setNewSaSchoolExistingId] = useState(null);

  // Add dependent state
  const [showAddDependent, setShowAddDependent] = useState(false);
  const [depName, setDepName] = useState('');
  const [depRole, setDepRole] = useState('');
  const [depBirthday, setDepBirthday] = useState('');
  const [depColor, setDepColor] = useState('teal');
  const [addingDependent, setAddingDependent] = useState(false);

  // School state
  const [depAttendsSchool, setDepAttendsSchool] = useState(false);
  const [depSchoolSearch, setDepSchoolSearch] = useState('');
  const [depSchoolResults, setDepSchoolResults] = useState([]);
  const [depSelectedSchool, setDepSelectedSchool] = useState(null);
  const [searchingSchools, setSearchingSchools] = useState(false);
  // SA path for the add-dependent modal — see the equivalent newSa* vars
  // above for the same pattern.
  const [depSaSchoolName, setDepSaSchoolName] = useState('');
  const [depSaSchoolExistingId, setDepSaSchoolExistingId] = useState(null);
  const [householdSchools, setHouseholdSchools] = useState([]);
  const [childActivities, setChildActivities] = useState({}); // { childId: [activities] }

  // Edit profile state
  const [editingMember, setEditingMember] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileColor, setProfileColor] = useState('teal');
  const [profileReminderTime, setProfileReminderTime] = useState('');
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSchoolId, setProfileSchoolId] = useState(null);
  // Edit-modal mirror of the add-dependent flow's `depAttendsSchool` toggle.
  // Defaulted to true in openEditProfile if the member already has a school
  // (so existing data isn't hidden), false otherwise. Toggling off clears the
  // school selection so saving persists null.
  const [profileAttendsSchool, setProfileAttendsSchool] = useState(false);
  const [editSchoolSearch, setEditSchoolSearch] = useState('');
  const [editSchoolResults, setEditSchoolResults] = useState([]);
  const [editSelectedSchoolData, setEditSelectedSchoolData] = useState(null); // full GIAS school data for new school creation
  // SA path for the edit-profile modal. profileSaSchoolName tracks the
  // (possibly newly-typed) name; profileSaSchoolExistingId, if set,
  // means "reuse this household_schools row" — typically populated when
  // the user clicks a chip to pick a sibling's school. The existing
  // profileSchoolId already covers "this member is currently linked to
  // school X" for both UK and SA — these two new vars handle the typing
  // step before that link is persisted.
  const [profileSaSchoolName, setProfileSaSchoolName] = useState('');
  const [profileSaSchoolExistingId, setProfileSaSchoolExistingId] = useState(null);
  const [editActivities, setEditActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [addActivityDay, setAddActivityDay] = useState(0);
  const [addActivityName, setAddActivityName] = useState('');
  const [addActivityEnd, setAddActivityEnd] = useState('');
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [savingActivity, setSavingActivity] = useState(false);
  const [editTermDates, setEditTermDates] = useState([]);
  const [showAddTermDate, setShowAddTermDate] = useState(false);
  const [termDateType, setTermDateType] = useState('inset_day');
  const [termDateDate, setTermDateDate] = useState('');
  const [termDateEndDate, setTermDateEndDate] = useState('');
  const [termDateLabel, setTermDateLabel] = useState('');
  const [savingTermDate, setSavingTermDate] = useState(false);
  const [icalUrl, setIcalUrl] = useState('');
  const [importingIcal, setImportingIcal] = useState(false);
  const [showTermDateOptions, setShowTermDateOptions] = useState(false);
  const [termDateSchoolId, setTermDateSchoolId] = useState(null);
  const [termDateSchoolName, setTermDateSchoolName] = useState('');
  const [termDateSchoolLA, setTermDateSchoolLA] = useState('');
  const [importingLA, setImportingLA] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [importingWebsite, setImportingWebsite] = useState(false);
  const [termImportIcalUrl, setTermImportIcalUrl] = useState('');
  const [importingTermIcal, setImportingTermIcal] = useState(false);
  const [importError, setImportError] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  const [editingTermDate, setEditingTermDate] = useState(null);
  const [editTermDateFields, setEditTermDateFields] = useState({});
  const [savingTermDateEdit, setSavingTermDateEdit] = useState(false);
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [clearingTermDates, setClearingTermDates] = useState(false);
  const [newYearNudgeDismissed, setNewYearNudgeDismissed] = useState(false);

  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => { const m = data?.members; setMembers(Array.isArray(m) ? m : []); })
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); loadSchools(); }, []);

  function loadSchools() {
    api.get('/schools')
      .then(({ data }) => {
        const sch = Array.isArray(data?.schools) ? data.schools : [];
        setHouseholdSchools(sch);
        // Build activities map from school data
        const actMap = {};
        sch.forEach(s => {
          (s.children || []).forEach(c => {
            if (c.activities?.length) actMap[c.id] = c.activities;
          });
        });
        setChildActivities(actMap);
      })
      .catch(() => {});
  }

  async function handleSchoolSearch(query) {
    setDepSchoolSearch(query);
    if (query.trim().length < 2) { setDepSchoolResults([]); return; }
    setSearchingSchools(true);
    try {
      const { data } = await api.get(`/schools/search?q=${encodeURIComponent(query.trim())}`);
      setDepSchoolResults(data.schools || []);
    } catch { setDepSchoolResults([]); }
    finally { setSearchingSchools(false); }
  }

  function selectSchool(school) {
    setDepSelectedSchool(school);
    setDepSchoolSearch(school.name);
    setDepSchoolResults([]);
  }

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
    setDepAttendsSchool(false);
    setDepSchoolSearch('');
    setDepSelectedSchool(null);
    setDepSchoolResults([]);
    setShowAddDependent(true);
  }

  async function handleAddDependent() {
    if (!depName.trim()) { setError('Name is required.'); return; }
    setAddingDependent(true);
    setError('');
    try {
      // If school is selected, ensure it exists in household first.
      // Two paths: UK uses the GIAS-shaped depSelectedSchool object;
      // SA uses the free-text depSaSchoolName (+ optional existing-row
      // pointer when the user clicked a chip for a sibling's school).
      let schoolId = null;
      if (depAttendsSchool && isSa && depSaSchoolName.trim()) {
        if (depSaSchoolExistingId) {
          schoolId = depSaSchoolExistingId;
        } else {
          const { data: schoolData } = await api.post('/schools', {
            school_name: depSaSchoolName.trim(),
          });
          schoolId = schoolData.school.id;
        }
      } else if (depAttendsSchool && depSelectedSchool) {
        // UK path — match by GIAS URN.
        const existingSchool = householdSchools.find(s => s.school_urn === depSelectedSchool.urn);
        if (existingSchool) {
          schoolId = existingSchool.id;
        } else {
          const { data: schoolData } = await api.post('/schools', {
            school_name: depSelectedSchool.name,
            school_urn: depSelectedSchool.urn,
            school_type: depSelectedSchool.type,
            local_authority: depSelectedSchool.local_authority,
            postcode: depSelectedSchool.postcode,
          });
          schoolId = schoolData.school.id;
        }
      }

      await api.post('/household/dependents', {
        name: depName.trim(),
        family_role: depRole.trim() || null,
        birthday: depBirthday || null,
        color_theme: depColor,
        school_id: schoolId,
      });
      setShowAddDependent(false);
      await loadMembers();
      const updatedSchools = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(updatedSchools);

      // If a NEW school was just created (not existing), show term date import options
      if (schoolId && !householdSchools.find(s => s.id === schoolId)) {
        const newSchool = updatedSchools.find(s => s.id === schoolId);
        if (newSchool) {
          setTermDateSchoolId(schoolId);
          setTermDateSchoolName(newSchool.school_name);
          setTermDateSchoolLA(newSchool.local_authority || '');
          setImportError('');
          setShowTermDateOptions(true);
          return; // Don't show generic success — the term date flow will handle it
        }
      }
      setSuccess('Member added!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add member.');
    } finally {
      setAddingDependent(false);
    }
  }

  // Remove a household_schools row (typed school) from the SA chip
  // picker. Warns if any family members are linked to it — the backend
  // will refuse the delete in that case (FK constraint), so we surface
  // the problem upfront rather than show a generic 500. Refreshes both
  // the schools list and the chip-selection state so the UI matches
  // reality after the delete.
  async function handleRemoveHouseholdSchool(schoolId) {
    const school = householdSchools.find((s) => s.id === schoolId);
    if (!school) return;
    const linkedChildren = school.children?.map((c) => c.name).filter(Boolean) || [];
    const confirmMsg = linkedChildren.length
      ? `Remove ${school.school_name}? ${linkedChildren.join(', ')} ${linkedChildren.length === 1 ? 'is' : 'are'} currently linked to it and will be unlinked.`
      : `Remove ${school.school_name}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.delete(`/schools/${schoolId}`);
      const fresh = await api.get('/schools').then((r) => r.data.schools || []);
      setHouseholdSchools(fresh);
      // Clear any chip-selection pointers that referenced the removed
      // school so the modals don't try to link to a row that no longer
      // exists.
      if (depSaSchoolExistingId === schoolId) {
        setDepSaSchoolExistingId(null);
        setDepSaSchoolName('');
      }
      if (newSaSchoolExistingId === schoolId) {
        setNewSaSchoolExistingId(null);
        setNewSaSchoolName('');
      }
      if (profileSaSchoolExistingId === schoolId) {
        setProfileSaSchoolExistingId(null);
        setProfileSaSchoolName('');
      }
    } catch (err) {
      setError(err.response?.data?.error || `Could not remove ${school.school_name}.`);
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
    setProfileSchoolId(member.school_id || null);
    setProfileAttendsSchool(Boolean(member.school_id));
    const school = householdSchools.find(s => s.id === member.school_id);
    setEditSchoolSearch(school?.school_name || '');
    setEditSchoolResults([]);
    // SA path: pre-fill the typed name + the existing-school pointer.
    // The UK GIAS-search inputs above are simply unused on SA households.
    setProfileSaSchoolName(school?.school_name || '');
    setProfileSaSchoolExistingId(school?.id || null);
    setShowAddActivity(false);
    setShowAddTermDate(false);
    setEditTermDates([]);
    // Weekly activities AND term dates load for any member with a
    // school linked, regardless of whether they're a dependent or a
    // full Family Member. A teen with their own login can have an
    // after-school schedule the same way a younger sibling can —
    // it's just personal-schedule data tied to a school day.
    if (member.school_id) {
      setLoadingActivities(true);
      api.get(`/schools/activities/${member.id}`)
        .then(({ data }) => setEditActivities(data.activities || []))
        .catch(() => setEditActivities([]))
        .finally(() => setLoadingActivities(false));
      api.get(`/schools/${member.school_id}/term-dates`)
        .then(({ data }) => setEditTermDates(data.term_dates || []))
        .catch(() => setEditTermDates([]));
      const school = householdSchools.find(s => s.id === member.school_id);
      setIcalUrl(school?.ical_url || '');
    } else {
      setEditActivities([]);
    }
  }

  async function handleAddActivity() {
    if (!addActivityName.trim() || !editingMember) return;
    setSavingActivity(true);
    try {
      const { data } = await api.post('/schools/activities', {
        child_id: editingMember.id,
        day_of_week: addActivityDay,
        activity: addActivityName.trim(),
        time_end: addActivityEnd || null,
      });
      setEditActivities(prev => [...prev, data.activity]);
      setAddActivityName('');
      setAddActivityEnd('');
      setShowAddActivity(false);
      await loadSchools(); // refresh activity pills
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add activity.');
    } finally {
      setSavingActivity(false);
    }
  }

  async function handleAddTermDate() {
    if (!termDateDate || !editingMember?.school_id) return;
    setSavingTermDate(true);
    try {
      const now = new Date();
      const academicYear = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
      const { data } = await api.post(`/schools/${editingMember.school_id}/term-dates`, {
        dates: [{
          academic_year: academicYear,
          event_type: termDateType,
          date: termDateDate,
          end_date: termDateEndDate || null,
          label: termDateLabel.trim() || null,
          source: 'manual',
        }],
      });
      setEditTermDates(prev => [...prev, ...(data.term_dates || [])]);
      setShowAddTermDate(false);
      setTermDateDate('');
      setTermDateEndDate('');
      setTermDateLabel('');
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add term date.');
    } finally {
      setSavingTermDate(false);
    }
  }

  async function handleDeleteTermDate(dateId) {
    try {
      await api.delete(`/schools/term-dates/${dateId}`);
      setEditTermDates(prev => prev.filter(d => d.id !== dateId));
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove term date.');
    }
  }

  async function handleImportIcal() {
    if (!icalUrl.trim() || !editingMember?.school_id) return;
    setImportingIcal(true);
    try {
      const { data } = await api.post(`/schools/${editingMember.school_id}/import-ical`, { ical_url: icalUrl.trim() });
      setSuccess(data.message || 'Calendar imported!');
      setTimeout(() => setSuccess(''), 3000);
      // Refresh term dates
      const { data: tdData } = await api.get(`/schools/${editingMember.school_id}/term-dates`);
      setEditTermDates(tdData.term_dates || []);
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not import calendar.');
    } finally {
      setImportingIcal(false);
    }
  }

  // South African national term-date import. The unified national
  // calendar (effective 2026 onwards) applies to every public school,
  // so there's no per-school lookup negotiation — one tap copies the
  // canonical national dates onto this household_schools row.
  async function handleImportSaTermDates() {
    if (!termDateSchoolId) return;
    setImportingLA(true); // reuse the LA-import busy flag — only one
                          // primary import button is on screen per country
    setImportError('');
    try {
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-sa-term-dates`);
      if (!data?.count) {
        setImportError(data?.message || 'No South African term dates available for this year yet.');
        return;
      }
      setSuccess(data.message || 'Term dates imported!');
      setTimeout(() => setSuccess(''), 3000);
      setShowTermDateOptions(false);
      setImportError('');
      await loadSchools();
      if (editingMember?.school_id === termDateSchoolId) {
        const { data: tdData } = await api.get(`/schools/${termDateSchoolId}/term-dates`);
        setEditTermDates(tdData.term_dates || []);
      }
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not import South African term dates. Try another option below.');
    } finally {
      setImportingLA(false);
    }
  }

  async function handleImportLADates() {
    if (!termDateSchoolId) return;
    setImportingLA(true);
    setImportError('');
    try {
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-la-dates`);
      if (data.imported === 0) {
        setImportError(data.message || 'No term dates found. Try another import method.');
        return;
      }
      setSuccess(data.message || 'Term dates imported!');
      setTimeout(() => setSuccess(''), 3000);
      setShowTermDateOptions(false);
      setImportError('');
      await loadSchools();
      // Refresh term dates in edit modal if open
      if (editingMember?.school_id === termDateSchoolId) {
        const { data: tdData } = await api.get(`/schools/${termDateSchoolId}/term-dates`);
        setEditTermDates(tdData.term_dates || []);
      }
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not import LA dates. Try another option below.');
    } finally {
      setImportingLA(false);
    }
  }

  async function handleImportWebsite() {
    if (!termDateSchoolId || !websiteUrl.trim()) return;
    setImportingWebsite(true);
    setImportError('');
    try {
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-website`, { website_url: websiteUrl.trim() });
      if (data.imported === 0) {
        setImportError(data.message || 'No term dates found on that page. Try a different URL or another import method.');
        return;
      }
      setSuccess(data.message || 'Term dates imported!');
      setTimeout(() => setSuccess(''), 3000);
      setShowTermDateOptions(false);
      setImportError('');
      await loadSchools();
      if (editingMember?.school_id === termDateSchoolId) {
        const { data: tdData } = await api.get(`/schools/${termDateSchoolId}/term-dates`);
        setEditTermDates(tdData.term_dates || []);
      }
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not import from website. Try another option below.');
    } finally {
      setImportingWebsite(false);
    }
  }

  async function handleImportTermIcal() {
    if (!termDateSchoolId || !termImportIcalUrl.trim()) return;
    setImportingTermIcal(true);
    setImportError('');
    try {
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-ical`, { ical_url: termImportIcalUrl.trim() });
      if (data.imported === 0) {
        setImportError(data.message || 'No events found in that calendar feed. Try another option.');
        return;
      }
      setSuccess(data.message || 'Calendar imported!');
      setTimeout(() => setSuccess(''), 3000);
      setShowTermDateOptions(false);
      setImportError('');
      await loadSchools();
      if (editingMember?.school_id === termDateSchoolId) {
        const { data: tdData } = await api.get(`/schools/${termDateSchoolId}/term-dates`);
        setEditTermDates(tdData.term_dates || []);
      }
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not import calendar. Try another option below.');
    } finally {
      setImportingTermIcal(false);
    }
  }

  // UK academic year runs Sept-Aug, so a Jan date belongs to the AY
  // that started the previous Sept. SA runs on the calendar year — much
  // simpler. Used as a fallback when the AI doesn't tag academic_year
  // on a row (it almost always does).
  function getAcademicYearUk(dateStr) {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth();
    return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
  }
  function getAcademicYearSa(dateStr) {
    return String(new Date(dateStr).getFullYear());
  }

  // Bucket a list of term-date rows into school terms, grouped by
  // academic year. The shape of each AY's buckets differs between
  // countries — UK uses three named seasons, SA uses four numbered
  // terms — so we return an *array* of { key, label, dates } per AY
  // and let the render iterate generically.
  //
  // Bucketing strategy: use the term_start events themselves as
  // authoritative boundaries. An event goes into term[i] when the i-th
  // term_start date is the latest term_start <= the event's date. This
  // correctly handles schools whose terms cross calendar-quarter
  // boundaries (e.g. SA Term 3 ending Sep 22 vs Term 4 starting Oct 5).
  // The earlier static "Sept-20 cutoff" lost both the Sep-22 term_end
  // (bucketed into Term 4) and the Term 3 boundary view (no term_end
  // in its bucket → fallback to listing every date).
  //
  // Fallback to month-based bucketing only when there are no term_start
  // events in a year — defensive, rarely hits.
  function groupDatesByTerm(dates, country) {
    const isSa = country === 'ZA';
    const termLabels = isSa
      ? [
          { key: 'term1', label: 'Term 1' },
          { key: 'term2', label: 'Term 2' },
          { key: 'term3', label: 'Term 3' },
          { key: 'term4', label: 'Term 4' },
        ]
      : [
          { key: 'autumn', label: 'Autumn' },
          { key: 'spring', label: 'Spring' },
          { key: 'summer', label: 'Summer' },
        ];
    const getAyFallback = isSa ? getAcademicYearSa : getAcademicYearUk;

    // Group all events by academic year first.
    const byYear = {};
    for (const td of dates) {
      const ay = td.academic_year || getAyFallback(td.date);
      (byYear[ay] ||= []).push(td);
    }

    const result = {};
    for (const ay of Object.keys(byYear)) {
      const yearEvents = byYear[ay];
      // Term boundaries: sorted term_start dates.
      const termStarts = yearEvents
        .filter((e) => e.event_type === 'term_start')
        .sort((a, b) => a.date.localeCompare(b.date));
      const termGroups = termLabels.map((def) => ({ ...def, dates: [] }));

      if (termStarts.length > 0) {
        for (const td of yearEvents) {
          // Find the latest term_start <= this event's date.
          let termIdx = 0;
          for (let i = 0; i < termStarts.length; i++) {
            if (td.date >= termStarts[i].date) termIdx = i;
            else break;
          }
          if (termIdx < termGroups.length) {
            termGroups[termIdx].dates.push(td);
          }
        }
      } else {
        // Fallback: month-based bucketing. Only triggers when no
        // term_start events exist for the year (e.g. a partially-
        // imported year planner). Same boundaries as the old static
        // logic — imperfect but better than nothing.
        for (const td of yearEvents) {
          const m = new Date(td.date).getMonth();
          let idx;
          if (isSa) {
            if (m <= 2) idx = 0;
            else if (m <= 5) idx = 1;
            else if (m <= 8) idx = 2;
            else idx = 3;
          } else if (m >= 8 && m <= 11) idx = 0;
          else if (m >= 0 && m <= 3) idx = 1;
          else if (m >= 4 && m <= 7) idx = 2;
          else continue;
          if (idx < termGroups.length) termGroups[idx].dates.push(td);
        }
      }

      for (const g of termGroups) {
        g.dates.sort((a, b) => a.date.localeCompare(b.date));
      }
      result[ay] = termGroups;
    }
    return result;
  }

  function getTermSummary(termDates) {
    const starts = termDates.filter(d => d.event_type === 'term_start');
    const ends = termDates.filter(d => d.event_type === 'term_end');
    const halfTerms = termDates.filter(d => d.event_type === 'half_term_start' || d.event_type === 'half_term_end');
    const insets = termDates.filter(d => d.event_type === 'inset_day');
    const start = starts[0]?.date;
    const end = ends[0]?.date;
    const htStart = halfTerms.find(d => d.event_type === 'half_term_start');
    const htEnd = halfTerms.find(d => d.event_type === 'half_term_end') || htStart;
    return { start, end, htStart: htStart?.date, htEnd: htEnd?.end_date || htEnd?.date, insets };
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: undefined });
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function shouldShowNewYearNudge(school) {
    if (newYearNudgeDismissed) return false;
    const today = new Date();
    const currentYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
    const ayStart = new Date(currentYear, 8, 1);
    const ayEnd = new Date(currentYear + 1, 7, 31);
    const totalDays = (ayEnd - ayStart) / (1000 * 60 * 60 * 24);
    const daysPassed = (today - ayStart) / (1000 * 60 * 60 * 24);
    if (daysPassed / totalDays < 0.75) return false;
    const nextAY = `${currentYear + 1}/${currentYear + 2}`;
    const nextYearDates = (school?.term_dates || []).filter(d => {
      const ay = d.academic_year || getAcademicYear(d.date);
      return ay === nextAY || ay === `${currentYear + 1}-${currentYear + 2}`;
    });
    return nextYearDates.length === 0;
  }

  function openUpdateTermDates() {
    const school = householdSchools.find(s => s.id === editingMember?.school_id);
    if (!school) return;
    setTermDateSchoolId(school.id);
    setTermDateSchoolName(school.school_name);
    setTermDateSchoolLA(school.local_authority || '');
    setImportError('');
    setWebsiteUrl('');
    setTermImportIcalUrl('');
    setShowTermDateOptions(true);
  }

  async function handleUpdateTermDate(dateId) {
    if (!editTermDateFields.date) return;
    setSavingTermDateEdit(true);
    try {
      await api.patch(`/schools/${editingMember.school_id}/term-dates/${dateId}`, editTermDateFields);
      // Refresh term dates
      const { data } = await api.get(`/schools/${editingMember.school_id}/term-dates`);
      setEditTermDates(data.term_dates || []);
      setEditingTermDate(null);
      setEditTermDateFields({});
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update term date.');
    } finally {
      setSavingTermDateEdit(false);
    }
  }

  // Bulk-clear every term date for a school. Country-agnostic — the
  // backend endpoint just nukes the rows and resets the source/last-
  // updated metadata, leaving the school itself (and the member's link
  // to it) untouched. Confirm dialog mentions the school by name so
  // the user can't bin a sibling's school's dates by mistake.
  async function handleClearAllTermDates(schoolId) {
    if (!schoolId) return;
    const school = householdSchools.find((s) => s.id === schoolId);
    if (!school) return;
    if (!window.confirm(`Clear all term dates for ${school.school_name}? You can re-import them at any time.`)) return;
    setClearingTermDates(true);
    try {
      await api.delete(`/schools/${schoolId}/term-dates`);
      setEditTermDates([]);
      await loadSchools();
      setSuccess('Term dates cleared.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not clear term dates.');
    } finally {
      setClearingTermDates(false);
    }
  }

  async function handleSyncIcal() {
    const school = householdSchools.find(s => s.id === editingMember?.school_id);
    if (!school?.ical_url) return;
    setSyncingIcal(true);
    try {
      const { data } = await api.post(`/schools/${school.id}/sync-ical`);
      setSuccess(data.message || 'Synced successfully!');
      setTimeout(() => setSuccess(''), 3000);
      const { data: tdData } = await api.get(`/schools/${school.id}/term-dates`);
      setEditTermDates(tdData.term_dates || []);
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Sync failed. Check the iCal URL.');
    } finally {
      setSyncingIcal(false);
    }
  }

  async function handleDeleteActivity(activityId) {
    try {
      await api.delete(`/schools/activities/${activityId}`);
      setEditActivities(prev => prev.filter(a => a.id !== activityId));
      await loadSchools();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove activity.');
    }
  }

  async function handleEditSchoolSearch(query) {
    setEditSchoolSearch(query);
    if (query.trim().length < 2) { setEditSchoolResults([]); return; }
    try {
      const { data } = await api.get(`/schools/search?q=${encodeURIComponent(query.trim())}`);
      setEditSchoolResults(data.schools || []);
    } catch { setEditSchoolResults([]); }
  }

  function selectEditSchool(school) {
    // Check if school exists in household, if so use that ID
    const existing = householdSchools.find(s => s.school_urn === school.urn);
    setProfileSchoolId(existing ? existing.id : `new:${school.urn}`);
    setEditSelectedSchoolData(school); // store full GIAS data for new school creation
    setEditSchoolSearch(school.name);
    setEditSchoolResults([]);
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

      // Handle school assignment. The /household/profile endpoint accepts
      // school_id for any member (it's a column on the users table, used by
      // both full Family Members and dependents) so we always send it. This
      // lets parents associate a teen's user account with a school the same
      // way they'd associate a younger child as a dependent.
      //
      // Three flows feed into payload.school_id:
      //   • UK new school: profileSchoolId starts with 'new:' (GIAS-search
      //     hasn't been linked yet) — create from editSelectedSchoolData.
      //   • SA: branch on profileAttendsSchool + the SA name/existingId
      //     state. Existing id wins; otherwise create-by-name.
      //   • Existing link (either country): just use profileSchoolId.
      let createdNewSchool = false;
      if (isSa && profileAttendsSchool) {
        if (profileSaSchoolExistingId) {
          payload.school_id = profileSaSchoolExistingId;
        } else if (profileSaSchoolName.trim()) {
          const { data: created } = await api.post('/schools', {
            school_name: profileSaSchoolName.trim(),
          });
          payload.school_id = created.school.id;
          createdNewSchool = !created.existing;
        } else {
          payload.school_id = null;
        }
      } else if (isSa && !profileAttendsSchool) {
        payload.school_id = null;
      } else if (profileSchoolId && String(profileSchoolId).startsWith('new:')) {
        // UK: need to create the school in household first
        const schoolData = editSelectedSchoolData || {};
        const { data: created } = await api.post('/schools', {
          school_name: schoolData.name || editSchoolSearch,
          school_urn: schoolData.urn || profileSchoolId.replace('new:', ''),
          school_type: schoolData.type,
          local_authority: schoolData.local_authority,
          postcode: schoolData.postcode,
        });
        payload.school_id = created.school.id;
        createdNewSchool = !created.existing;
      } else {
        payload.school_id = profileSchoolId || null;
      }

      // Check if school changed (new school linked that may need term dates)
      const schoolChanged = payload.school_id && payload.school_id !== editingMember?.school_id;

      // When admin edits another member, include target user_id
      if (!isEditingSelf) {
        payload.user_id = targetId;
      }

      const oldSchoolId = editingMember?.school_id;

      await api.patch('/household/profile', payload);
      await loadMembers();

      // If the school was removed or changed, check if old school is now orphaned (no children left)
      if (oldSchoolId && oldSchoolId !== payload.school_id) {
        const schoolsAfterSave = await api.get('/schools').then(r => r.data.schools || []);
        const oldSchool = schoolsAfterSave.find(s => s.id === oldSchoolId);
        if (oldSchool && (!oldSchool.children || oldSchool.children.length === 0)) {
          try {
            await api.delete(`/schools/${oldSchoolId}`);
          } catch (e) {
            console.warn('Could not auto-remove orphaned school:', e);
          }
        }
      }

      // Fetch the definitive school list (after any orphan cleanup)
      const freshSchools = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(freshSchools);

      // Only update auth context if editing own profile
      if (isEditingSelf) {
        const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor };
        login({ token, user: updatedUser, household });
      }
      setEditingMember(null);

      // If school changed, show term date import options — but ONLY if the school has no term dates yet
      if (schoolChanged) {
        const school = freshSchools.find(s => s.id === payload.school_id);
        if (school && (!school.term_dates || school.term_dates.length === 0)) {
          setTermDateSchoolId(payload.school_id);
          setTermDateSchoolName(school.school_name);
          setTermDateSchoolLA(school.local_authority || '');
          setImportError('');
          setShowTermDateOptions(true);
          return;
        }
      }

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
      });
      setSuccess('Settings saved!');
      login({ token, user, household: data.household });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  function toggleAllergy(key) {
    setHouseholdAllergies(prev =>
      prev.includes(key) ? prev.filter(a => a !== key) : [...prev, key]
    );
  }

  async function handleSaveAllergies() {
    setSavingAllergies(true);
    try {
      const { data } = await api.patch('/settings/settings', { allergies: JSON.stringify(householdAllergies) });
      // Update auth context so allergies persist across page navigations
      if (data.household) {
        login({ token, user, household: data.household });
      }
    } catch (err) {
      console.error('Could not save allergies:', err);
    } finally {
      setSavingAllergies(false);
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

  // Search GIAS by name/postcode for the invite modal. Same shape as
  // handleSchoolSearch (dependent flow) but writes into the invite-specific
  // state so the two modals don't share results.
  async function handleNewMemberSchoolSearch(query) {
    setNewSchoolSearch(query);
    if (query.trim().length < 2) { setNewSchoolResults([]); return; }
    setSearchingNewSchools(true);
    try {
      const { data } = await api.get(`/schools/search?q=${encodeURIComponent(query)}`);
      setNewSchoolResults(data.schools || []);
    } catch { setNewSchoolResults([]); }
    finally { setSearchingNewSchools(false); }
  }

  function selectNewMemberSchool(school) {
    setNewSelectedSchool(school);
    setNewSchoolSearch(school.name);
    setNewSchoolResults([]);
  }

  async function handleAddMember() {
    if (!newName.trim()) { setError('Name is required.'); return; }
    if (!newEmail.trim()) { setError('Email is required to send the invite.'); return; }
    setAddingMember(true);
    setError('');
    try {
      // If a school is selected, ensure it exists as a household_schools row
      // before the invite is created — the invites table FK references that
      // table. Two paths mirror handleAddDependent: UK by GIAS URN, SA by
      // free-text name (with optional existing-row pointer for siblings).
      let schoolId = null;
      if (newAttendsSchool && isSa && newSaSchoolName.trim()) {
        if (newSaSchoolExistingId) {
          schoolId = newSaSchoolExistingId;
        } else {
          const { data: schoolData } = await api.post('/schools', {
            school_name: newSaSchoolName.trim(),
          });
          schoolId = schoolData.school.id;
        }
      } else if (newAttendsSchool && newSelectedSchool) {
        const existing = householdSchools.find(s => s.school_urn === newSelectedSchool.urn);
        if (existing) {
          schoolId = existing.id;
        } else {
          const { data: schoolData } = await api.post('/schools', {
            school_name: newSelectedSchool.name,
            school_urn: newSelectedSchool.urn,
            school_type: newSelectedSchool.type,
            local_authority: newSelectedSchool.local_authority,
            postcode: newSelectedSchool.postcode,
          });
          schoolId = schoolData.school.id;
        }
      }

      await api.post('/household/invite', {
        email: newEmail.trim(),
        name: newName.trim(),
        family_role: newRole.trim() || null,
        birthday: newBirthday || null,
        color_theme: newColor,
        school_id: schoolId,
      });
      setShowAddMember(false);
      // Reset invite-flow school state for the next time the modal opens.
      setNewAttendsSchool(false);
      setNewSchoolSearch('');
      setNewSelectedSchool(null);
      setNewSchoolResults([]);
      setNewSaSchoolName('');
      setNewSaSchoolExistingId(null);
      setSuccess(`Invite sent to ${newEmail.trim()}`);
      setTimeout(() => setSuccess(''), 3000);
      const { data } = await api.get('/household/invites');
      setPendingInvites(data.invites ?? []);
      // Refresh household schools — a new one may have just been created.
      const refreshedSchools = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(refreshedSchools);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send invite.');
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1
        className="flex text-[36px] font-normal leading-none text-bark items-center gap-2"
        style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
      >
        <div
          className="hidden"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: '#f1eef8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconUsers className="h-5 w-5 text-plum" />
        </div>
        Family Setup
      </h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!canWrite && <SubscribePrompt message="Subscribe to invite family members and edit profiles" />}

      {/* Household card */}
      <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
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
            <p className="text-xs text-cocoa mt-2">Only admins can change household settings.</p>
          </div>
        )}
      </div>

      {/* Members */}
      <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
        <h2 className="font-semibold text-bark mb-4 flex items-center gap-2"><IconUsers className="h-4 w-4" /> Family Members</h2>
        {loadingMembers ? <Spinner /> : (
          <ul className="space-y-4">
            {members.filter(m => m.member_type !== 'dependent').map((m) => {
              const avatarClass = AVATAR_COLOURS[m.color_theme] || AVATAR_COLOURS.teal;
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
              {pendingInvites.map((inv) => {
                // Build a wa.me deep-link with a friendly preset message
                // so the inviter can pass the invite into a WhatsApp
                // chat without typing the link manually. wa.me opens
                // the recipient's WhatsApp share-sheet on tap; the
                // user picks who to send to.
                const inviteUrl = `${window.location.origin}/signup?invite=${inv.token}`;
                const inviteeName = (inv.name || '').trim();
                const greeting = inviteeName ? `Hi ${inviteeName.split(' ')[0]}` : 'Hey';
                const waText = `${greeting} — I've set up our family on Housemait so we can keep our calendar, shopping and tasks in one place. Tap to join: ${inviteUrl}`;
                const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
                return (
                  <li key={inv.id} className="flex items-center justify-between text-sm text-cocoa bg-oat rounded-xl px-3 py-2">
                    <span>{inv.name || inv.email}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cocoa">
                        {inv.name ? inv.email : ''} · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </span>
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-success hover:text-success/80 transition-colors"
                        title="Share invite link via WhatsApp"
                      >
                        Share via WhatsApp
                      </a>
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
                );
              })}
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
      <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconUsers className="h-4 w-4" /> Other Family Members</h2>
        <p className="text-xs text-cocoa mb-3">Family members who don't need their own account (e.g. infants, young children, pets). They can be assigned tasks and events.</p>
        {loadingMembers ? <Spinner /> : (
          <>
            {members.filter(m => m.member_type === 'dependent').length > 0 ? (
              <ul className="space-y-4">
                {members.filter(m => m.member_type === 'dependent').map((m) => {
                  const avatarClass = AVATAR_COLOURS[m.color_theme] || AVATAR_COLOURS.teal;
                  return (
                    <li key={m.id} className="flex items-center gap-3">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt={m.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className={`w-9 h-9 rounded-full ${avatarClass} flex items-center justify-center font-bold text-sm shrink-0`}>
                          {m.name[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-bark">{m.name}</p>
                        {m.family_role && <p className="text-xs text-cocoa">{m.family_role}</p>}
                        {/* School badge */}
                        {m.school_id && (() => {
                          const school = householdSchools.find(s => s.id === m.school_id);
                          return school ? (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky/15 text-sky">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky" />
                              {school.school_name}
                            </span>
                          ) : null;
                        })()}
                        {/* Activity pills */}
                        {childActivities[m.id]?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(() => {
                              // Group activities: "PE Tue & Thu", "Swimming Fri"
                              const grouped = {};
                              childActivities[m.id].forEach(a => {
                                if (!grouped[a.activity]) grouped[a.activity] = [];
                                grouped[a.activity].push(DAY_LABELS[a.day_of_week]);
                              });
                              return Object.entries(grouped).map(([activity, days]) => (
                                <span key={activity} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-cream-border/50 text-cocoa">
                                  {activity} {days.join(' & ')}
                                </span>
                              ));
                            })()}
                          </div>
                        )}
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

      {/* Schools coming-soon placeholder — only for countries we don't
          yet support (UK and SA each have their own flow inline in the
          member modals; everywhere else sees this card). */}
      {!showSchools && (
        <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <h2 className="font-semibold text-bark mb-1 flex items-center gap-2">
            <span className="text-base" aria-hidden="true">🌍</span>
            Schools
          </h2>
          <p className="text-sm text-cocoa">
            School directory and term-date imports are currently available
            in the UK and South Africa. Coming soon to more countries —
            until then, the rest of Housemait works the same.
          </p>
        </div>
      )}

      {/* Allergies & Dietary Requirements */}
      <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
        <h2 className="font-semibold text-bark mb-1 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
          Allergies & Dietary Requirements
        </h2>
        <p className="text-xs text-cocoa mb-4">Select any allergens or dietary requirements for your household. The AI will avoid these when suggesting recipes and meals.</p>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'celery', label: 'Celery' },
            { key: 'gluten', label: 'Gluten' },
            { key: 'crustaceans', label: 'Crustaceans' },
            { key: 'eggs', label: 'Eggs' },
            { key: 'fish', label: 'Fish' },
            { key: 'lupin', label: 'Lupin' },
            { key: 'milk', label: 'Milk / Dairy' },
            { key: 'molluscs', label: 'Molluscs' },
            { key: 'mustard', label: 'Mustard' },
            { key: 'nuts', label: 'Tree Nuts' },
            { key: 'peanuts', label: 'Peanuts' },
            { key: 'sesame', label: 'Sesame' },
            { key: 'soya', label: 'Soya' },
            { key: 'sulphites', label: 'Sulphites' },
            { key: 'vegetarian', label: 'Vegetarian' },
            { key: 'vegan', label: 'Vegan' },
            { key: 'halal', label: 'Halal' },
            { key: 'kosher', label: 'Kosher' },
          ].map(({ key, label }) => {
            const selected = householdAllergies.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleAllergy(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  selected
                    ? 'bg-coral/10 border-coral text-coral'
                    : 'border-cream-border text-cocoa hover:border-bark'
                }`}
              >
                {selected && <span className="mr-1">&#10003;</span>}
                {label}
              </button>
            );
          })}
        </div>
        <button
          onClick={handleSaveAllergies}
          disabled={savingAllergies}
          className="mt-4 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
        >
          {savingAllergies ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Add Dependent Modal */}
      {showAddDependent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddDependent(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
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
                  AVATAR_COLOURS[depColor] || AVATAR_COLOURS.teal
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
                <input type="date" value={depBirthday} onChange={(e) => setDepBirthday(e.target.value)} style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block' }} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
                <div className="grid grid-cols-8 gap-2.5">
                  {COLOUR_OPTIONS.map(({ key, bg, ring }) => (
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

              {/* School toggle — only shown for countries we support. UK
                  gets the GIAS search; SA gets a free-text name input
                  plus chips for any existing household schools. Other
                  countries see the Schools coming-soon card up top
                  instead. */}
              {showSchools && (
              <div className="bg-cream rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-bark">Do they attend school?</span>
                <button
                  type="button"
                  onClick={() => setDepAttendsSchool(!depAttendsSchool)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${depAttendsSchool ? 'bg-primary' : 'bg-cream-border'}`}
                >
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${depAttendsSchool ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
              )}

              {/* UK: GIAS school search */}
              {isUk && depAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-bark mb-1">School</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={depSchoolSearch}
                          onChange={(e) => handleSchoolSearch(e.target.value)}
                          className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                          placeholder="Search by name or postcode..."
                        />
                        {searchingSchools && <span className="absolute right-3 top-3 text-xs text-cocoa">Searching...</span>}
                        {depSchoolResults.length > 0 && (
                          <ul className="absolute z-10 w-full bg-white border border-cream-border rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
                            {depSchoolResults.map(s => (
                              <li key={s.urn}>
                                <button type="button" onClick={() => selectSchool(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-cream transition-colors">
                                  <span className="font-medium text-bark">{s.name}</span>
                                  <span className="text-xs text-cocoa block">{s.local_authority} · {s.postcode} · {s.type}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {/* Same-school detection */}
                      {depSelectedSchool && householdSchools.find(s => s.school_urn === depSelectedSchool.urn) && (
                        <div className="mt-2 bg-plum-light rounded-lg px-3 py-2">
                          <p className="text-xs font-semibold text-plum">SAME SCHOOL AS {householdSchools.find(s => s.school_urn === depSelectedSchool.urn)?.children?.map(c => c.name.toUpperCase()).join(' AND ')}</p>
                          <p className="text-xs text-plum/70">Term dates already set up — just add {depName || 'their'} activities below.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SA: free-text school name + existing-school chips. SA
                  doesn't have a public school directory like GIAS, so we
                  let parents type the name and pick from their household's
                  already-linked schools (typical case: second child at
                  the same school as their sibling). */}
              {isSa && depAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-bark mb-1">School name</label>
                    <input
                      type="text"
                      value={depSaSchoolName}
                      onChange={(e) => {
                        setDepSaSchoolName(e.target.value);
                        setDepSaSchoolExistingId(null);
                      }}
                      className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                      placeholder="e.g. Sandown Primary"
                    />
                  </div>
                  {householdSchools.length > 0 && (
                    <div>
                      <p className="text-xs text-cocoa mb-2">Or use a school you&apos;ve already added:</p>
                      <div className="flex flex-wrap gap-2">
                        {householdSchools.map((s) => {
                          const selected = depSaSchoolExistingId === s.id;
                          return (
                            <div
                              key={s.id}
                              className={`inline-flex items-stretch rounded-lg border overflow-hidden transition-colors ${
                                selected
                                  ? 'bg-plum-light border-plum text-plum'
                                  : 'bg-white border-cream-border text-bark hover:border-plum'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setDepSaSchoolName(s.school_name);
                                  setDepSaSchoolExistingId(s.id);
                                }}
                                className="text-xs px-2.5 py-1.5"
                              >
                                {s.school_name}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveHouseholdSchool(s.id)}
                                aria-label={`Remove ${s.school_name}`}
                                className={`px-2 text-xs border-l hover:bg-coral-light hover:text-coral ${
                                  selected ? 'border-plum' : 'border-cream-border'
                                }`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden"
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
                  AVATAR_COLOURS[newColor] || AVATAR_COLOURS.teal
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
                <input type="date" value={newBirthday} onChange={(e) => setNewBirthday(e.target.value)} style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block' }} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
                <div className="grid grid-cols-8 gap-2.5">
                  {COLOUR_OPTIONS.map(({ key, bg, ring }) => (
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

              {/* School toggle — same pattern as the add-dependent flow.
                  Pre-fills the school + year group on the invite so the
                  fields are already set when the invitee accepts.
                  Only shown for countries with a school flow (UK + SA). */}
              {showSchools && (
              <div className="bg-cream rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-bark">
                  {`Does ${newName.trim() || 'this member'} attend school?`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !newAttendsSchool;
                    setNewAttendsSchool(next);
                    if (!next) {
                      setNewSchoolSearch('');
                      setNewSchoolResults([]);
                      setNewSelectedSchool(null);
                      setNewSaSchoolName('');
                      setNewSaSchoolExistingId(null);
                    }
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors ${newAttendsSchool ? 'bg-primary' : 'bg-cream-border'}`}
                >
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${newAttendsSchool ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
              )}

              {isUk && newAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-bark mb-1">School</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={newSchoolSearch}
                          onChange={(e) => handleNewMemberSchoolSearch(e.target.value)}
                          className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                          placeholder="Search by name or postcode..."
                        />
                        {searchingNewSchools && <span className="absolute right-3 top-3 text-xs text-cocoa">Searching...</span>}
                        {newSchoolResults.length > 0 && (
                          <ul className="absolute z-10 w-full bg-white border border-cream-border rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
                            {newSchoolResults.map(s => (
                              <li key={s.urn}>
                                <button type="button" onClick={() => selectNewMemberSchool(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-cream transition-colors">
                                  <span className="font-medium text-bark">{s.name}</span>
                                  <span className="text-xs text-cocoa block">{s.local_authority} · {s.postcode} · {s.type}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {/* Surface 'same school as Tom' hint when relevant */}
                      {newSelectedSchool && householdSchools.find(s => s.school_urn === newSelectedSchool.urn) && (
                        <div className="mt-2 bg-plum-light rounded-lg px-3 py-2">
                          <p className="text-xs font-semibold text-plum">SAME SCHOOL AS {householdSchools.find(s => s.school_urn === newSelectedSchool.urn)?.children?.map(c => c.name.toUpperCase()).join(' AND ')}</p>
                          <p className="text-xs text-plum/70">Term dates already set up.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SA: free-text + existing-school chips — see Add Dependent
                  modal above for the same pattern + rationale. */}
              {isSa && newAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-bark mb-1">School name</label>
                    <input
                      type="text"
                      value={newSaSchoolName}
                      onChange={(e) => {
                        setNewSaSchoolName(e.target.value);
                        setNewSaSchoolExistingId(null);
                      }}
                      className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                      placeholder="e.g. Sandown Primary"
                    />
                  </div>
                  {householdSchools.length > 0 && (
                    <div>
                      <p className="text-xs text-cocoa mb-2">Or use a school you&apos;ve already added:</p>
                      <div className="flex flex-wrap gap-2">
                        {householdSchools.map((s) => {
                          const selected = newSaSchoolExistingId === s.id;
                          return (
                            <div
                              key={s.id}
                              className={`inline-flex items-stretch rounded-lg border overflow-hidden transition-colors ${
                                selected
                                  ? 'bg-plum-light border-plum text-plum'
                                  : 'bg-white border-cream-border text-bark hover:border-plum'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setNewSaSchoolName(s.school_name);
                                  setNewSaSchoolExistingId(s.id);
                                }}
                                className="text-xs px-2.5 py-1.5"
                              >
                                {s.school_name}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveHouseholdSchool(s.id)}
                                aria-label={`Remove ${s.school_name}`}
                                className={`px-2 text-xs border-l hover:bg-coral-light hover:text-coral ${
                                  selected ? 'border-plum' : 'border-cream-border'
                                }`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

      {/* Term Date Import Options Modal */}
      {showTermDateOptions && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowTermDateOptions(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-bark">Import term dates</h2>
              <button onClick={() => setShowTermDateOptions(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-cocoa mb-4">
              How would you like to set up term dates for <span className="font-medium text-bark">{termDateSchoolName}</span>?
            </p>

            {importError && (
              <div className="bg-coral/10 border border-coral/30 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
                <span className="text-coral text-sm mt-0.5">⚠️</span>
                <div>
                  <p className="text-sm text-bark font-medium">{importError}</p>
                  <p className="text-xs text-cocoa mt-1">Please try another option below.</p>
                </div>
              </div>
            )}

            {/* Four equal options, no recommended badge or section headers
                — the user already knows which type of school their kid
                attends, and each card's subtitle says when it applies. The
                top card varies by country: UK gets the LA import, SA gets
                the unified national term-date import. The three fallback
                cards (website / iCal / manual) are identical across
                countries — they're generic over school type. */}
            <div className="space-y-3">
              {/* Country-specific top card — UK: LA, SA: national. */}
              {isSa ? (
                <div className="bg-white rounded-xl border border-cream-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-bark">🇿🇦 Import South African national term dates</h3>
                      <p className="text-xs text-cocoa mt-1">
                        From 2026, a unified national calendar applies to every
                        public school across all nine provinces. One tap copies
                        those dates onto this school.
                      </p>
                    </div>
                    <button
                      onClick={handleImportSaTermDates}
                      disabled={importingLA}
                      className="shrink-0 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50 transition-colors"
                    >
                      {importingLA ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-cream-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-bark">🏛️ Import from local authority</h3>
                      <p className="text-xs text-cocoa mt-1">
                        Most state schools follow their council&apos;s term dates.
                        {termDateSchoolLA
                          ? ` We will import them from ${termDateSchoolLA} council.`
                          : ' We will look up and import them automatically.'}
                      </p>
                    </div>
                    <button
                      onClick={handleImportLADates}
                      disabled={importingLA}
                      className="shrink-0 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50 transition-colors"
                    >
                      {importingLA ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                </div>
              )}

              {/* Option: Import from school website */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <h3 className="text-sm font-semibold text-bark">🌐 Import from school website</h3>
                <p className="text-xs text-cocoa mt-1">Paste the URL of your school's term dates page.</p>
                <div className="flex gap-2 mt-2">
                  <input
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://school.com/term-dates"
                    className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={handleImportWebsite}
                    disabled={importingWebsite || !websiteUrl.trim()}
                    className="shrink-0 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50 transition-colors"
                  >
                    {importingWebsite ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>

              {/* Option 3: iCal import */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <h3 className="text-sm font-semibold text-bark">📅 Import from iCal feed</h3>
                <p className="text-xs text-cocoa mt-1">Paste the iCal calendar URL from your school's website or parent portal.</p>
                <div className="flex gap-2 mt-2">
                  <input
                    type="url"
                    value={termImportIcalUrl}
                    onChange={(e) => setTermImportIcalUrl(e.target.value)}
                    placeholder="https://school.com/calendar.ics"
                    className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={handleImportTermIcal}
                    disabled={importingTermIcal || !termImportIcalUrl.trim()}
                    className="shrink-0 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50 transition-colors"
                  >
                    {importingTermIcal ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>

              {/* Option 4: Manual */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-bark">✏️ Add manually</h3>
                    <p className="text-xs text-cocoa mt-1">Enter term dates yourself. You can do this now or later from the child's profile.</p>
                  </div>
                  <button
                    onClick={() => setShowTermDateOptions(false)}
                    className="shrink-0 border border-cream-border text-cocoa text-xs font-medium px-4 py-2 rounded-lg hover:bg-sand transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingMember(null)}>
          <div className="absolute inset-0 bg-black/40" />
          {/* overflow-x-hidden clips any horizontal overflow from native iOS
              date/time inputs that would otherwise push past the modal edge.
              Vertical scrolling still works via overflow-y-auto. p-4 on mobile
              (instead of flat p-6) gives narrow phones more room for the
              native picker controls. */}
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden"
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
                    AVATAR_COLOURS[profileColor] || AVATAR_COLOURS.teal
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

              {/* Native iOS date/time inputs have an intrinsic min-width that
                  can exceed narrow modal widths, causing horizontal overflow.
                  min-w-0 + overflow-hidden on the wrapper, and appearance:none
                  + maxWidth:100% on the input itself, kill the overflow without
                  losing the native picker (which still triggers on tap). */}
              <div className="min-w-0 overflow-hidden">
                <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
                <input
                  type="date"
                  value={profileBirthday}
                  onChange={(e) => setProfileBirthday(e.target.value)}
                  style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block' }}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Color theme</label>
                <div className="grid grid-cols-8 gap-2.5">
                  {COLOUR_OPTIONS.map(({ key, bg, ring }) => (
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

              {/* School toggle — same pattern as the add-dependent form.
                  Hidden by default for members without a school; defaulted on
                  if the member already has a school attached (so existing data
                  isn't surprise-hidden). Toggling off clears the selection so
                  the save persists null. Shown for UK + SA. */}
              {showSchools && (
              <div className="bg-cream rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-bark">
                  {editingMember?.member_type === 'dependent'
                    ? 'Do they attend school?'
                    : `Does ${profileName || 'this member'} attend school?`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !profileAttendsSchool;
                    setProfileAttendsSchool(next);
                    if (!next) {
                      setProfileSchoolId(null);
                      setEditSchoolSearch('');
                      setEditSchoolResults([]);
                      setEditSelectedSchoolData(null);
                      setProfileSaSchoolName('');
                      setProfileSaSchoolExistingId(null);
                    }
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors ${profileAttendsSchool ? 'bg-primary' : 'bg-cream-border'}`}
                >
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${profileAttendsSchool ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
              )}

              {/* School details — only shown when the toggle above is on. The
                  activities + term-dates card below is still dependent-only
                  because those are the bits a parent manages on a younger
                  child's behalf. */}
              {isUk && profileAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-bark mb-1">School</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={editSchoolSearch}
                          onChange={(e) => handleEditSchoolSearch(e.target.value)}
                          className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                          placeholder="Search by name or postcode..."
                        />
                        {editSchoolResults.length > 0 && (
                          <ul className="absolute z-10 w-full bg-white border border-cream-border rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
                            {editSchoolResults.map(s => (
                              <li key={s.urn}>
                                <button type="button" onClick={() => selectEditSchool(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-cream transition-colors">
                                  <span className="font-medium text-bark">{s.name}</span>
                                  <span className="text-xs text-cocoa block">{s.local_authority} · {s.postcode}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {profileSchoolId && editSchoolSearch && (
                        <button type="button" onClick={() => { setProfileSchoolId(null); setEditSchoolSearch(''); }} className="text-xs text-error mt-1">Remove school</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SA: free-text + existing-school chips, same pattern as the
                  add-dependent and invite modals. */}
              {isSa && profileAttendsSchool && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-bark mb-1">School name</label>
                    <input
                      type="text"
                      value={profileSaSchoolName}
                      onChange={(e) => {
                        setProfileSaSchoolName(e.target.value);
                        setProfileSaSchoolExistingId(null);
                      }}
                      className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                      placeholder="e.g. Sandown Primary"
                    />
                  </div>
                  {householdSchools.length > 0 && (
                    <div>
                      <p className="text-xs text-cocoa mb-2">Or use a school you&apos;ve already added:</p>
                      <div className="flex flex-wrap gap-2">
                        {householdSchools.map((s) => {
                          const selected = profileSaSchoolExistingId === s.id;
                          return (
                            <div
                              key={s.id}
                              className={`inline-flex items-stretch rounded-lg border overflow-hidden transition-colors ${
                                selected
                                  ? 'bg-plum-light border-plum text-plum'
                                  : 'bg-white border-cream-border text-bark hover:border-plum'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setProfileSaSchoolName(s.school_name);
                                  setProfileSaSchoolExistingId(s.id);
                                }}
                                className="text-xs px-2.5 py-1.5"
                              >
                                {s.school_name}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveHouseholdSchool(s.id)}
                                aria-label={`Remove ${s.school_name}`}
                                className={`px-2 text-xs border-l hover:bg-coral-light hover:text-coral ${
                                  selected ? 'border-plum' : 'border-cream-border'
                                }`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Weekly activities — any member with a school linked.
                  Previously gated to dependents only, but the data model
                  has no such restriction and a teen with their own login
                  is just as likely to want their schedule tracked as a
                  younger sibling. Term dates render in a sibling block
                  below under the same any-member-with-a-school rule. */}
              {editingMember?.school_id && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-plum flex items-center gap-1.5">📅 Weekly activities</h3>
                  <p className="text-xs text-cocoa">{profileName || 'Their'} regular weekly schedule during term time</p>

                  {loadingActivities ? <Spinner /> : (
                    <>
                      <div className="grid grid-cols-5 gap-1.5 mt-2">
                        {DAY_LABELS.map((day, idx) => {
                          const dayActivities = editActivities.filter(a => a.day_of_week === idx);
                          return (
                            <div key={day} className="text-center">
                              <div className="text-[11px] font-semibold text-cocoa mb-1">{day}</div>
                              {dayActivities.length > 0 ? (
                                <div className="space-y-1">
                                  {dayActivities.map(a => (
                                    <div key={a.id} className="bg-white rounded-lg px-1.5 py-1.5 text-[11px] text-bark border border-cream-border relative group">
                                      <div className="font-medium">{a.activity}</div>
                                      {a.time_end && <div className="text-cocoa text-[10px]">til {a.time_end.substring(0, 5)}</div>}
                                      <button
                                        onClick={() => handleDeleteActivity(a.id)}
                                        className="absolute -top-1 -right-1 w-4 h-4 bg-error text-white rounded-full text-[9px] hidden group-hover:flex items-center justify-center"
                                        title="Remove"
                                      >×</button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-cocoa text-sm py-2">—</div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Add activity form */}
                      {showAddActivity ? (
                        <div className="bg-white rounded-lg border border-cream-border p-3 mt-2 space-y-2">
                          <div className="flex gap-2">
                            <select value={addActivityDay} onChange={(e) => setAddActivityDay(Number(e.target.value))} className="border border-cream-border rounded-lg px-2 py-2 text-sm bg-white">
                              {DAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                            </select>
                            <input type="text" value={addActivityName} onChange={(e) => setAddActivityName(e.target.value)} placeholder="e.g. PE, Swimming" className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent" />
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className="text-xs text-cocoa">Ends at:</label>
                            <input type="time" value={addActivityEnd} onChange={(e) => setAddActivityEnd(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                            <div className="flex-1" />
                            <button onClick={() => setShowAddActivity(false)} className="text-xs text-cocoa">Cancel</button>
                            <button onClick={handleAddActivity} disabled={savingActivity || !addActivityName.trim()} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                              {savingActivity ? 'Adding...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setShowAddActivity(true); setAddActivityName(''); setAddActivityEnd(''); }}
                          className="mt-2 w-full border-2 border-dashed border-cream-border text-cocoa hover:border-primary hover:text-primary font-medium py-2 rounded-xl text-xs transition-colors"
                        >
                          + Add activity
                        </button>
                      )}
                    </>
                  )}

                </div>
              )}

              {/* Term dates — shown for any member who has a school, not
                  just dependents. Without this lift, an adult member who
                  was added with a school would land in a dead-end where
                  they could see the linked school but had no UI to
                  trigger the import-term-dates modal. */}
              {editingMember?.school_id && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  {(() => {
                    const school = householdSchools.find(s => s.id === editingMember.school_id);
                    const grouped = groupDatesByTerm(editTermDates, household?.country);
                    const academicYears = Object.keys(grouped).sort();
                    const siblings = members.filter(m => m.school_id === editingMember.school_id && m.id !== editingMember.id);

                    return (
                      <>
                        <h3 className="text-sm font-semibold text-plum flex items-center gap-1.5 mt-4">📅 Term dates</h3>
                        {school && <p className="text-xs text-cocoa">{school.school_name}</p>}

                        {/* Sibling note */}
                        {siblings.length > 0 && (
                          <div className="bg-plum/5 border border-plum/15 rounded-lg px-3 py-2 mt-1">
                            <p className="text-[11px] text-plum">These dates apply to all children at {school?.school_name}.</p>
                          </div>
                        )}

                        {/* New year nudge */}
                        {school && shouldShowNewYearNudge(school) && (
                          <div className="bg-amber/10 border border-amber/30 rounded-lg px-3 py-2 mt-2 flex items-center justify-between">
                            <p className="text-xs text-bark">💡 Next year's term dates may be available.</p>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={openUpdateTermDates} className="text-xs font-medium text-primary hover:text-primary-pressed">Update</button>
                              <button onClick={() => setNewYearNudgeDismissed(true)} className="text-xs text-cocoa hover:text-bark">Dismiss</button>
                            </div>
                          </div>
                        )}

                        {editTermDates.length > 0 ? (
                          <div className="mt-2 space-y-3">
                            {/* Compact term summary per academic year.
                                grouped[ay] is now a country-aware array
                                of { key, label, dates } so the render is
                                identical for UK (Autumn/Spring/Summer)
                                and SA (Term 1-4). */}
                            {academicYears.map(ay => {
                              const termGroups = grouped[ay];
                              return (
                                <div key={ay} className="bg-white rounded-lg border border-cream-border p-3">
                                  <div className="text-[11px] font-semibold text-cocoa uppercase tracking-wide mb-1.5">{ay}</div>
                                  {termGroups.map(({ key, label, dates: termDates }) => {
                                    if (termDates.length === 0) return null;
                                    const summary = getTermSummary(termDates);
                                    return (
                                      <div key={key} className="mb-1.5 last:mb-0">
                                        <div className="flex items-baseline gap-2">
                                          <span className="text-xs font-semibold text-bark w-16">{label}</span>
                                          <span className="text-[11px] text-cocoa">
                                            {summary.start && summary.end
                                              ? `${formatDateShort(summary.start)} – ${formatDateShort(summary.end)}`
                                              : termDates.map(d => formatDateShort(d.date)).join(', ')
                                            }
                                          </span>
                                        </div>
                                        {/* "Half term" is UK-only terminology — SA schools don't
                                            use this concept (four discrete terms with breaks
                                            between, not within). Even if legacy data has half_term_*
                                            rows, we suppress the sub-line for SA. The dates
                                            themselves still appear in the full View-and-edit list. */}
                                        {!isSa && summary.htStart && (
                                          <div className="ml-16 text-[11px] text-cocoa">
                                            Half term: {formatDateShort(summary.htStart)}{summary.htEnd && summary.htEnd !== summary.htStart ? ` – ${formatDateShort(summary.htEnd)}` : ''}
                                          </div>
                                        )}
                                        {summary.insets.length > 0 && (
                                          <div className="ml-16 text-[11px] text-cocoa">
                                            INSET: {summary.insets.map(d => formatDateShort(d.date)).join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}

                            {/* Source & last updated */}
                            <div className="text-[11px] text-cocoa space-y-0.5">
                              {school?.term_dates_source && (
                                <p>Source: {
                                  { local_authority: `Local authority (${school.local_authority || ''})`, school_website: 'School website', ical: 'iCal feed', manual: 'Manual' }[school.term_dates_source] || school.term_dates_source
                                }</p>
                              )}
                              {school?.term_dates_last_updated && (
                                <p>Last updated: {new Date(school.term_dates_last_updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                              )}
                            </div>

                            {/* iCal sync status */}
                            {school?.ical_url && (
                              <div className="text-[11px] text-cocoa">
                                {school.ical_last_sync_status === 'failed' ? (
                                  <div className="flex items-center gap-1 text-amber">
                                    <span>⚠️ Sync failed</span>
                                    {school.ical_last_sync && <span>· Last successful sync: {new Date(school.ical_last_sync).toLocaleDateString('en-GB')}</span>}
                                  </div>
                                ) : school.ical_last_sync ? (
                                  <div className="flex items-center gap-1 text-sage">
                                    <span>✅ Auto-syncing daily</span>
                                    <span>· Last sync: {new Date(school.ical_last_sync).toLocaleDateString('en-GB')}</span>
                                  </div>
                                ) : null}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-2 mt-1">
                              {school?.ical_url ? (
                                <>
                                  <button onClick={handleSyncIcal} disabled={syncingIcal} className="text-xs font-medium text-primary hover:text-primary-pressed disabled:opacity-50">
                                    🔄 {syncingIcal ? 'Syncing...' : 'Sync now'}
                                  </button>
                                  <span className="text-cream-border">|</span>
                                  <button onClick={openUpdateTermDates} className="text-xs font-medium text-primary hover:text-primary-pressed">
                                    Change source
                                  </button>
                                </>
                              ) : (
                                <button onClick={openUpdateTermDates} className="text-xs font-medium text-primary hover:text-primary-pressed">
                                  🔄 Update term dates
                                </button>
                              )}
                              <span className="text-cream-border">|</span>
                              <button onClick={() => setShowAllDates(true)} className="text-xs font-medium text-primary hover:text-primary-pressed">
                                View & edit all dates
                              </button>
                              <span className="text-cream-border">|</span>
                              <button
                                onClick={() => handleClearAllTermDates(editingMember.school_id)}
                                disabled={clearingTermDates}
                                className="text-xs font-medium text-coral hover:text-coral/80 disabled:opacity-50"
                              >
                                {clearingTermDates ? 'Clearing…' : 'Clear all'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <p className="text-xs text-cocoa mb-2">No term dates added yet.</p>
                            <button
                              onClick={openUpdateTermDates}
                              className="w-full bg-primary text-white text-xs font-medium py-2.5 rounded-xl hover:bg-primary-pressed transition-colors"
                            >
                              Import term dates
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {editingMember?.member_type !== 'dependent' && (
                <div className="min-w-0 overflow-hidden">
                  <label className="block text-sm font-medium text-bark mb-1">Daily reminder time</label>
                  <input
                    type="time"
                    value={profileReminderTime}
                    onChange={(e) => setProfileReminderTime(e.target.value)}
                    style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', display: 'block' }}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  />
                  <p className="text-xs text-cocoa mt-1">
                    {profileReminderTime ? 'Your personal reminder time.' : `If empty, sent at ${householdReminderTime}.`}
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

      {/* View & Edit All Dates Panel */}
      {showAllDates && editingMember?.school_id && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setShowAllDates(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-bark">All term dates</h2>
              <button onClick={() => setShowAllDates(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-cocoa mb-4">{householdSchools.find(s => s.id === editingMember.school_id)?.school_name}</p>

            {(() => {
              const grouped = groupDatesByTerm(editTermDates, household?.country);
              const academicYears = Object.keys(grouped).sort();
              const TYPE_LABELS = { term_start: 'Term starts', term_end: 'Term ends', half_term_start: 'Half term starts', half_term_end: 'Half term ends', inset_day: 'INSET Day', bank_holiday: 'Bank Holiday' };
              const TYPE_COLORS = { term_start: 'text-sage', term_end: 'text-sage', half_term_start: 'text-amber', half_term_end: 'text-amber', inset_day: 'text-coral', bank_holiday: 'text-plum' };

              return (
                <div className="space-y-4">
                  {academicYears.map(ay => {
                    const termGroups = grouped[ay];
                    return (
                      <div key={ay}>
                        {termGroups.map(({ key, label, dates: termDates }) => {
                          if (termDates.length === 0) return null;
                          // Heading suffixes "TERM" only for UK seasons
                          // ("AUTUMN TERM"). SA labels already contain
                          // "Term" so we don't double it up to "TERM 1 TERM".
                          const heading = `${label.toUpperCase()}${label.toLowerCase().includes('term') ? '' : ' TERM'} ${ay}`;
                          return (
                            <div key={key} className="mb-3">
                              <div className="text-[10px] font-bold text-cocoa uppercase tracking-wider mb-1.5 border-b border-cream-border pb-1">{heading}</div>
                              <div className="space-y-1">
                                {termDates.map(td => (
                                  <div key={td.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white group text-xs">
                                    {editingTermDate === td.id ? (
                                      <div className="flex-1 space-y-1.5">
                                        <div className="flex gap-2">
                                          <select
                                            value={editTermDateFields.event_type || td.event_type}
                                            onChange={(e) => setEditTermDateFields(prev => ({ ...prev, event_type: e.target.value }))}
                                            className="border border-cream-border rounded px-1.5 py-1 text-xs bg-white"
                                          >
                                            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                          </select>
                                          <input
                                            type="text"
                                            value={editTermDateFields.label ?? td.label ?? ''}
                                            onChange={(e) => setEditTermDateFields(prev => ({ ...prev, label: e.target.value }))}
                                            placeholder="Label"
                                            className="flex-1 border border-cream-border rounded px-2 py-1 text-xs bg-white"
                                          />
                                        </div>
                                        <div className="flex gap-2 items-center">
                                          <input
                                            type="date"
                                            value={editTermDateFields.date || td.date}
                                            onChange={(e) => setEditTermDateFields(prev => ({ ...prev, date: e.target.value }))}
                                            className="border border-cream-border rounded px-2 py-1 text-xs bg-white"
                                          />
                                          <span className="text-cocoa">to</span>
                                          <input
                                            type="date"
                                            value={editTermDateFields.end_date ?? td.end_date ?? ''}
                                            onChange={(e) => setEditTermDateFields(prev => ({ ...prev, end_date: e.target.value }))}
                                            className="border border-cream-border rounded px-2 py-1 text-xs bg-white"
                                          />
                                          <div className="flex-1" />
                                          <button onClick={() => { setEditingTermDate(null); setEditTermDateFields({}); }} className="text-xs text-cocoa">Cancel</button>
                                          <button onClick={() => handleUpdateTermDate(td.id)} disabled={savingTermDateEdit} className="text-xs bg-primary text-white px-2 py-1 rounded font-medium disabled:opacity-50">
                                            {savingTermDateEdit ? 'Saving...' : 'Save'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="flex-1">
                                          <span className={`font-medium ${TYPE_COLORS[td.event_type] || 'text-bark'}`}>
                                            {td.label || TYPE_LABELS[td.event_type] || td.event_type.replace(/_/g, ' ')}
                                          </span>
                                          <span className="text-cocoa ml-2">{formatDateFull(td.date)}{td.end_date && td.end_date !== td.date ? ` – ${formatDateFull(td.end_date)}` : ''}</span>
                                        </div>
                                        <div className="hidden group-hover:flex items-center gap-1">
                                          <button
                                            onClick={() => { setEditingTermDate(td.id); setEditTermDateFields({ date: td.date, end_date: td.end_date || '', label: td.label || '', event_type: td.event_type }); }}
                                            className="text-primary hover:text-primary-pressed p-0.5" title="Edit"
                                          >✎</button>
                                          <button onClick={() => handleDeleteTermDate(td.id)} className="text-error/60 hover:text-error p-0.5" title="Delete">🗑</button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Add date button */}
                  {showAddTermDate ? (
                    <div className="bg-white rounded-lg border border-cream-border p-3 space-y-2">
                      <div className="flex gap-2">
                        <select value={termDateType} onChange={(e) => setTermDateType(e.target.value)} className="border border-cream-border rounded-lg px-2 py-2 text-xs bg-white">
                          <option value="term_start">Term start</option>
                          <option value="term_end">Term end</option>
                          <option value="half_term_start">Half term start</option>
                          <option value="half_term_end">Half term end</option>
                          <option value="inset_day">INSET day</option>
                          <option value="bank_holiday">Bank holiday</option>
                        </select>
                        <input type="text" value={termDateLabel} onChange={(e) => setTermDateLabel(e.target.value)} placeholder="Label (optional)" className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-xs bg-white" />
                      </div>
                      <div className="flex gap-2 items-center">
                        <input type="date" value={termDateDate} onChange={(e) => setTermDateDate(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                        <span className="text-xs text-cocoa">to</span>
                        <input type="date" value={termDateEndDate} onChange={(e) => setTermDateEndDate(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                        <div className="flex-1" />
                        <button onClick={() => setShowAddTermDate(false)} className="text-xs text-cocoa">Cancel</button>
                        <button onClick={handleAddTermDate} disabled={savingTermDate || !termDateDate} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                          {savingTermDate ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowAddTermDate(true)} className="w-full border-2 border-dashed border-cream-border text-cocoa hover:border-primary hover:text-primary font-medium py-2 rounded-xl text-xs transition-colors">
                      + Add date
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
