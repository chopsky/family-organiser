import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconUsers, IconHome, IconMail } from '../components/Icons';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const YEAR_GROUPS = ['Nursery', 'Reception', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6', 'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12', 'Year 13'];

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
  const [newColor, setNewColor] = useState('teal');
  const [newEmail, setNewEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);

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
  const [depYearGroup, setDepYearGroup] = useState('');
  const [searchingSchools, setSearchingSchools] = useState(false);
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
  const [profileYearGroup, setProfileYearGroup] = useState('');
  const [editSchoolSearch, setEditSchoolSearch] = useState('');
  const [editSchoolResults, setEditSchoolResults] = useState([]);
  const [editSelectedSchoolData, setEditSelectedSchoolData] = useState(null); // full GIAS school data for new school creation
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
  const [newYearNudgeDismissed, setNewYearNudgeDismissed] = useState(false);

  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => setMembers(data.members ?? []))
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); loadSchools(); }, []);

  function loadSchools() {
    api.get('/schools')
      .then(({ data }) => {
        setHouseholdSchools(data.schools || []);
        // Build activities map from school data
        const actMap = {};
        (data.schools || []).forEach(s => {
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
    setDepYearGroup('');
    setDepSchoolResults([]);
    setShowAddDependent(true);
  }

  async function handleAddDependent() {
    if (!depName.trim()) { setError('Name is required.'); return; }
    setAddingDependent(true);
    setError('');
    try {
      // If school is selected, ensure it exists in household first
      let schoolId = null;
      if (depAttendsSchool && depSelectedSchool) {
        // Check if this school already exists in the household
        const existingSchool = householdSchools.find(s => s.school_urn === depSelectedSchool.urn);
        if (existingSchool) {
          schoolId = existingSchool.id;
        } else {
          // Create new household school
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
        year_group: depAttendsSchool ? depYearGroup || null : null,
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
    setProfileYearGroup(member.year_group || '');
    const school = householdSchools.find(s => s.id === member.school_id);
    setEditSchoolSearch(school?.school_name || '');
    setEditSchoolResults([]);
    setShowAddActivity(false);
    setShowAddTermDate(false);
    setEditTermDates([]);
    // Load activities and term dates for this member
    if (member.member_type === 'dependent') {
      setLoadingActivities(true);
      api.get(`/schools/activities/${member.id}`)
        .then(({ data }) => setEditActivities(data.activities || []))
        .catch(() => setEditActivities([]))
        .finally(() => setLoadingActivities(false));
      // Load term dates if they have a school
      if (member.school_id) {
        api.get(`/schools/${member.school_id}/term-dates`)
          .then(({ data }) => setEditTermDates(data.term_dates || []))
          .catch(() => setEditTermDates([]));
        const school = householdSchools.find(s => s.id === member.school_id);
        setIcalUrl(school?.ical_url || '');
      }
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

  function getAcademicYear(dateStr) {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth();
    return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
  }

  function groupDatesByTerm(dates) {
    const terms = {};
    for (const td of dates) {
      const ay = td.academic_year || getAcademicYear(td.date);
      if (!terms[ay]) terms[ay] = { autumn: [], spring: [], summer: [], other: [] };
      const month = new Date(td.date).getMonth();
      if (month >= 8 && month <= 11) terms[ay].autumn.push(td);
      else if (month >= 0 && month <= 3) terms[ay].spring.push(td);
      else if (month >= 4 && month <= 7) terms[ay].summer.push(td);
      else terms[ay].other.push(td);
    }
    // Sort dates within each term
    for (const ay of Object.keys(terms)) {
      for (const term of Object.values(terms[ay])) {
        term.sort((a, b) => a.date.localeCompare(b.date));
      }
    }
    return terms;
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
        year_group: profileYearGroup || null,
      };

      // Handle school assignment for dependents
      let createdNewSchool = false;
      if (editingMember?.member_type === 'dependent') {
        if (profileSchoolId && String(profileSchoolId).startsWith('new:')) {
          // Need to create the school in household first
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
                              {m.year_group ? `${m.year_group}, ` : ''}{school.school_name}
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
                <input type="date" value={depBirthday} onChange={(e) => setDepBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
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

              {/* School toggle */}
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

              {/* School fields (shown when toggle is on) */}
              {depAttendsSchool && (
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
                    <div className="w-28">
                      <label className="block text-sm font-medium text-bark mb-1">Year group</label>
                      <select value={depYearGroup} onChange={(e) => setDepYearGroup(e.target.value)} className="w-full border border-cream-border rounded-lg px-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent bg-white text-sm">
                        <option value="">Select...</option>
                        {YEAR_GROUPS.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>
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
                <input type="date" value={newBirthday} onChange={(e) => setNewBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
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

            <div className="space-y-3">
              {/* Option 1: Import from LA */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-bark">🏛️ Import from local authority</h3>
                    <p className="text-xs text-cocoa mt-1">
                      {termDateSchoolLA
                        ? `Automatically import term dates from ${termDateSchoolLA} council.`
                        : 'Automatically look up and import term dates from the local authority.'}
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

              {/* Option 2: Import from school website */}
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

              {/* School details (dependents only) */}
              {editingMember?.member_type === 'dependent' && (
                <div className="border border-cream-border rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-plum flex items-center gap-1.5">📋 School details</h3>
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
                    <div className="w-28">
                      <label className="block text-sm font-medium text-bark mb-1">Year group</label>
                      <select value={profileYearGroup} onChange={(e) => setProfileYearGroup(e.target.value)} className="w-full border border-cream-border rounded-lg px-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent bg-white text-sm">
                        <option value="">Select...</option>
                        {YEAR_GROUPS.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Weekly activities grid */}
                  <h3 className="text-sm font-semibold text-plum flex items-center gap-1.5 mt-3">📅 Weekly activities</h3>
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

                  {/* Term dates section */}
                  {editingMember?.school_id && (() => {
                    const school = householdSchools.find(s => s.id === editingMember.school_id);
                    const grouped = groupDatesByTerm(editTermDates);
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
                            {/* Compact term summary per academic year */}
                            {academicYears.map(ay => {
                              const terms = grouped[ay];
                              return (
                                <div key={ay} className="bg-white rounded-lg border border-cream-border p-3">
                                  <div className="text-[11px] font-semibold text-cocoa uppercase tracking-wide mb-1.5">{ay}</div>
                                  {[
                                    { label: 'Autumn', dates: terms.autumn },
                                    { label: 'Spring', dates: terms.spring },
                                    { label: 'Summer', dates: terms.summer },
                                  ].map(({ label, dates: termDates }) => {
                                    if (termDates.length === 0) return null;
                                    const summary = getTermSummary(termDates);
                                    return (
                                      <div key={label} className="mb-1.5 last:mb-0">
                                        <div className="flex items-baseline gap-2">
                                          <span className="text-xs font-semibold text-bark w-14">{label}</span>
                                          <span className="text-[11px] text-cocoa">
                                            {summary.start && summary.end
                                              ? `${formatDateShort(summary.start)} – ${formatDateShort(summary.end)}`
                                              : termDates.map(d => formatDateShort(d.date)).join(', ')
                                            }
                                          </span>
                                        </div>
                                        {summary.htStart && (
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
              const grouped = groupDatesByTerm(editTermDates);
              const academicYears = Object.keys(grouped).sort();
              const TYPE_LABELS = { term_start: 'Term starts', term_end: 'Term ends', half_term_start: 'Half term starts', half_term_end: 'Half term ends', inset_day: 'INSET Day', bank_holiday: 'Bank Holiday' };
              const TYPE_COLORS = { term_start: 'text-sage', term_end: 'text-sage', half_term_start: 'text-amber', half_term_end: 'text-amber', inset_day: 'text-coral', bank_holiday: 'text-plum' };

              return (
                <div className="space-y-4">
                  {academicYears.map(ay => {
                    const terms = grouped[ay];
                    return (
                      <div key={ay}>
                        {[
                          { label: `AUTUMN TERM ${ay}`, dates: terms.autumn },
                          { label: `SPRING TERM ${ay}`, dates: terms.spring },
                          { label: `SUMMER TERM ${ay}`, dates: terms.summer },
                        ].map(({ label, dates: termDates }) => {
                          if (termDates.length === 0) return null;
                          return (
                            <div key={label} className="mb-3">
                              <div className="text-[10px] font-bold text-cocoa uppercase tracking-wider mb-1.5 border-b border-cream-border pb-1">{label}</div>
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
