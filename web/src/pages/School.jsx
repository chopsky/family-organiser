import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import {
  IconPlus, IconBell, IconGraduation, IconMessageCircle, IconCalendar,
} from '../components/Icons';
import { usesCalendarSchoolYear } from '../lib/country';
import { loadCached } from '../lib/offlineCache';
import PageHeader from '../components/ui/PageHeader';
import ActivityModal from '../components/ActivityModal';
import TermDatesSheet from '../components/TermDatesSheet';
import ReferralNudge from '../components/ReferralNudge';
import PillBtn from '../components/ui/PillBtn';
import { BottomSheet } from '../components/BottomSheet';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { ACTIVITY_ICONS, iconFor } from '../lib/activityIcons';
import useHasChildren from '../hooks/useHasChildren';
import { readTermDatesLa, clearTermDatesLa, laDisplayName } from '../lib/termDatesLa';

// Soft warm sand for inset chips / day pills (shared literal across the
// redesigned pages - no exact theme token for this neutral).
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

// Per-school accent swatches - a subset of the member palette so a school
// CAN match a member's colour ("St Helen's in my pink"), without inventing
// a second colour system. Multi-school households need distinguishable
// term dates on the calendar (real report 2026-08-11: three schools all on
// the default blue).
const SCHOOL_COLOURS = ['#6B3FA0', '#E8724A', '#7DAE82', '#E8A040', '#4A9FCC', '#C74E95', '#6558C7', '#3AADA0'];

// Small pickup-car glyph for the Activities rows.
function PickupCar({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13v5h-2.5M3 13v5h2.5M3 13h18" />
      <circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Term-aware weekly activities helpers ──
const isOngoingActivity = (a) => !a.start_date && !a.end_date;
// Is an activity running right now? Ongoing activities (no window) always are;
// term-bound ones are active only when today falls inside their window. Drives
// the Activities card's "this week" view.
const activityActiveToday = (a) => {
  if (isOngoingActivity(a)) return true;
  const today = new Date().toLocaleDateString('en-CA');
  if (a.start_date && a.start_date > today) return false;
  if (a.end_date && a.end_date < today) return false;
  return true;
};

export default function School() {
  // School management is collaborative, so gate on canManage (any adult
  // member), not the legacy single-admin flag — same rule as FamilySetup.
  const { household, canManage: isAdmin } = useAuth();
  // Country-specific school flow modes (every country has the feature):
  //   • UK: GIAS-driven school search + LA term-date scrape (full-fat)
  //   • SA: free-text school name + national term-date import
  //   • Other: free-text school name + the country-neutral term-date
  //     methods (website / PDF / iCal / manual) - no fork step
  const isGb = household?.country === 'GB';
  // Free-text add path: everyone except the UK (GIAS only covers GB).
  const freeTextSchool = !isGb;
  const hasChildren = useHasChildren();

  const [success, setSuccess] = useState('');
  // Flips true after a successful term-dates import - the delight peak
  // the referral nudge keys off.
  const [termWin, setTermWin] = useState(false);
  const [error, setError] = useState('');
  // Council handoff from the public term-dates pages (/signup?la=...):
  // greet the job they arrived with, and stop once it's done or dismissed.
  const [laHandoff, setLaHandoff] = useState(() => readTermDatesLa() || '');
  const dismissLaHandoff = () => { clearTermDatesLa(); setLaHandoff(''); };

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [householdSchools, setHouseholdSchools] = useState([]);
  const [childActivities, setChildActivities] = useState({}); // { childId: [activities] }
  const [colourPickerFor, setColourPickerFor] = useState(null); // school id with the swatch row open

  // Optimistic: paint the card immediately, revert if the PATCH fails. The
  // calendar picks the new colour up on its next term-dates fetch.
  async function handleSetSchoolColour(schoolId, colour) {
    setColourPickerFor(null);
    const prev = householdSchools;
    setHouseholdSchools((hs) => hs.map((s) => (s.id === schoolId ? { ...s, colour } : s)));
    try {
      await api.patch(`/schools/${schoolId}`, { colour });
    } catch {
      setHouseholdSchools(prev);
      setError('Could not save the colour. Try again in a moment.');
    }
  }

  // Standalone activity editor (driven by the Activities card). The form
  // itself is the shared <ActivityModal> (also used by the Calendar's
  // activity sheet); this holds { child, activity|null } while it's open.
  const [activityModal, setActivityModal] = useState(null);
  // { kid, activities } - the start-of-term rollover sheet for one child.
  const [newTermModal, setNewTermModal] = useState(null);

  // ── Term-dates machinery state ─────────────────────────────────────
  const [editTermDates, setEditTermDates] = useState([]);
  const [showAddTermDate, setShowAddTermDate] = useState(false);
  const [termDateType, setTermDateType] = useState('inset_day');
  const [termDateDate, setTermDateDate] = useState('');
  const [termDateEndDate, setTermDateEndDate] = useState('');
  const [termDateLabel, setTermDateLabel] = useState('');
  const [savingTermDate, setSavingTermDate] = useState(false);
  const [showTermDateOptions, setShowTermDateOptions] = useState(false);
  const [termDateSchoolId, setTermDateSchoolId] = useState(null);
  const [termDateSchoolName, setTermDateSchoolName] = useState('');
  // Shared school-directory offer for the term-dates import sheet: dates
  // another parent at the same school already imported ({found, school, dates}).
  const [directoryOffer, setDirectoryOffer] = useState(null);
  // Draft import: holds the AI-extracted rows + source-text snippet
  // between the /preview call and the admin's "Save" tap. null while
  // not previewing. Each row carries a `warnings: string[]` from the
  // backend validator (src/services/termDateValidator.js). The admin
  // can edit any row in-place before confirming.
  const [draftImport, setDraftImport] = useState(null);
  const [savingDraftImport, setSavingDraftImport] = useState(false);
  const [showSourceQuoteFor, setShowSourceQuoteFor] = useState(null); // row index whose quote tooltip is open
  const [importError, setImportError] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  // Add-a-school modal (create a school without first adding a child).
  const [addSchoolOpen, setAddSchoolOpen] = useState(false);
  const [addSchoolSearch, setAddSchoolSearch] = useState('');
  const [addSchoolResults, setAddSchoolResults] = useState([]);
  const [addSchoolSelected, setAddSchoolSelected] = useState(null);
  const [addSchoolSaName, setAddSchoolSaName] = useState('');
  const [addingSchool, setAddingSchool] = useState(false);
  // UK custom-school fallback for the Add-a-school modal: GIAS doesn't list
  // every school (independent / online / alternative-provision / very new).
  // No URN, so the local-authority term-date import stays gated off and the
  // user imports from the school website / PDF / iCal / manually instead.
  const [addSchoolManual, setAddSchoolManual] = useState(false);
  const [addSchoolManualName, setAddSchoolManualName] = useState('');
  const [addSchoolManualPostcode, setAddSchoolManualPostcode] = useState('');
  const [editingTermDate, setEditingTermDate] = useState(null);
  const [editTermDateFields, setEditTermDateFields] = useState({});
  const [savingTermDateEdit, setSavingTermDateEdit] = useState(false);
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [clearingTermDates, setClearingTermDates] = useState(false);

  function loadMembers() {
    return loadCached(
      'household:members',
      () => api.get('/household').then(r => r.data?.members ?? []),
      (m) => setMembers(Array.isArray(m) ? m : []),
    )
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  function loadSchools() {
    return loadCached(
      'schools',
      () => api.get('/schools').then(r => Array.isArray(r.data?.schools) ? r.data.schools : []),
      (sch) => setHouseholdSchools(sch),
    ).catch(() => {});
  }

  // Household-wide activities, grouped by child_id. Sourced from the dedicated
  // /schools/activities endpoint (not GET /schools) so a child with no school
  // link - the common case after the schools decoupling - still has their
  // after-school clubs surfaced in the Activities card.
  function loadActivities() {
    return loadCached(
      'household:activities',
      () => api.get('/schools/activities').then(r => Array.isArray(r.data?.activities) ? r.data.activities : []),
      (rows) => {
        const map = {};
        rows.forEach((a) => { (map[a.child_id] ??= []).push(a); });
        setChildActivities(map);
      },
    ).catch(() => {});
  }

  useEffect(() => { loadMembers(); loadSchools(); loadActivities(); }, []);

  // Open the shared ActivityModal in ADD / EDIT mode for a child. The
  // modal owns the form, term selector and API calls (it's the same
  // component the Calendar's activity sheet uses).
  // Bulk-remove a child's finished activities - one confirm instead of one
  // delete dialog per activity (the founder's own start-of-term complaint).
  async function clearExpiredActivities(kid, count) {
    const noun = count === 1 ? 'finished activity' : 'finished activities';
    if (!window.confirm(`Remove ${count} ${noun} for ${kid.name}? This can't be undone.`)) return;
    try {
      await api.post('/schools/activities/clear-expired', { child_id: kid.id });
      loadActivities();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not clear the finished activities.');
    }
  }

  function openAddActivity(child) {
    if (child) setActivityModal({ child, activity: null });
  }

  function openEditActivity(child, a) {
    if (child) setActivityModal({ child, activity: a });
  }

  // Remove a household_schools row. Warns if any family members are
  // linked to it - the backend will refuse the delete in that case (FK
  // constraint), so we surface the problem upfront rather than show a
  // generic 500.
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
    } catch (err) {
      setError(err.response?.data?.error || `Could not remove ${school.school_name}.`);
    }
  }

  async function handleAddTermDate() {
    if (!termDateDate || !termDateSchoolId) return;
    // Half-term entries need both ends of the range to be useful. A
    // half-term row with only a start date renders as a single line in
    // the grouped view, and the validator later flags it as
    // half-term-outside-any-term-bounds. Validate up-front instead of
    // accepting a malformed row.
    if (termDateType === 'half_term_start' && !termDateEndDate) {
      setError('Half-term needs both a start date and an end date (the day school resumes).');
      return;
    }
    // Same hard-stop for ranges where the end is before the start.
    if (termDateEndDate && termDateEndDate < termDateDate) {
      setError('The end date is before the start date.');
      return;
    }
    setSavingTermDate(true);
    setError('');
    try {
      // Derive the academic year from the actual date being added (not
      // today). Adding a date for next term that crosses an AY boundary
      // previously bucketed under "today's" AY, which then showed under
      // the wrong year heading in the grouped view.
      const academicYear = usesCalendarSchoolYear(household?.country)
        ? getAcademicYearSa(termDateDate)
        : getAcademicYearUk(termDateDate);
      const { data } = await api.post(`/schools/${termDateSchoolId}/term-dates`, {
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

  // Step 2 of 2: commit the admin-approved draft to the database.
  async function handleConfirmImportWebsite() {
    if (!draftImport || !draftImport.schoolId) return;
    setSavingDraftImport(true);
    try {
      // Strip client-only fields before sending.
      // eslint-disable-next-line no-unused-vars
      const payload = draftImport.dates.map(({ _id, warnings, source_quote, ...rest }) => rest);
      const { data } = await api.post(`/schools/${draftImport.schoolId}/import-website/confirm`, {
        dates: payload,
        source_url: draftImport.sourceUrl || null,
        source_text: draftImport.sourceText || null,
        source_type: draftImport.sourceType || 'website',
      });
      setSuccess(data.message || 'Term dates imported!');
      setTimeout(() => setSuccess(''), 3000);
      setDraftImport(null);
      await loadSchools();
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not save term dates.';
      const details = err.response?.data?.details;
      setImportError(details ? `${msg}\n${details.join('\n')}` : msg);
    } finally {
      setSavingDraftImport(false);
    }
  }

  function updateDraftRow(rowId, patch) {
    setDraftImport(prev => prev ? {
      ...prev,
      dates: prev.dates.map(d => d._id === rowId ? { ...d, ...patch } : d),
    } : prev);
  }

  function removeDraftRow(rowId) {
    setDraftImport(prev => prev ? {
      ...prev,
      dates: prev.dates.filter(d => d._id !== rowId),
    } : prev);
  }

  // UK academic year runs Sept-Aug, so a Jan date belongs to the AY
  // that started the previous Sept. SA runs on the calendar year - much
  // simpler. Used as a fallback when the AI doesn't tag academic_year
  // on a row (it almost always does).
  function getAcademicYearUk(dateStr) {
    // Must use HYPHEN here — the server stores AYs as `${year}-${year+1}`
    // (schools.js + routes that fall back to currentAY). The fallback
    // previously used a slash, so rows missing academic_year would
    // bucket into "2025/2026" while properly-tagged rows lived in
    // "2025-2026", showing as two separate years in the grouped UI.
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth();
    return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }
  function getAcademicYearSa(dateStr) {
    return String(new Date(dateStr).getFullYear());
  }

  // Bucket a list of term-date rows into school terms, grouped by
  // academic year. The shape of each AY's buckets differs between
  // countries - UK uses three named seasons, SA uses four numbered
  // terms - so we return an *array* of { key, label, dates } per AY
  // and let the render iterate generically.
  //
  // Bucketing strategy: use the term_start events themselves as
  // authoritative boundaries. An event goes into term[i] when the i-th
  // term_start date is the latest term_start <= the event's date. This
  // correctly handles schools whose terms cross calendar-quarter
  // boundaries (e.g. SA Term 3 ending Sep 22 vs Term 4 starting Oct 5).
  //
  // Fallback to month-based bucketing only when there are no term_start
  // events in a year - defensive, rarely hits.
  function groupDatesByTerm(dates, country) {
    // Calendar-year school countries (SA, AU, NZ) run four numbered terms
    // Jan-Dec; the northern convention is three named UK-style terms.
    const isCalYearCountry = usesCalendarSchoolYear(country);
    const termLabels = isCalYearCountry
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
    const getAyFallback = isCalYearCountry ? getAcademicYearSa : getAcademicYearUk;

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
        // Collapse term_starts into season boundaries. A year can have MORE
        // term_start events than season labels when the source lists each
        // HALF-term start separately (the LA directory does: "Autumn Term
        // second half start" etc.). Mapping term_start[i] -> season[i] then
        // breaks: the extra starts overflow past the 3 UK labels, so their
        // events get dropped or pushed under the wrong heading. For UK we
        // instead classify each term_start into a season by month and use the
        // EARLIEST start in each season as that season's boundary. SA keeps the
        // 1:1 index mapping (4 terms, 4 labels, one start each, sometimes
        // crossing calendar quarters).
        let boundaries;
        if (isCalYearCountry) {
          boundaries = termStarts.map((t, i) => ({ group: i, date: t.date }));
        } else {
          const seasonOf = (d) => { const m = new Date(d).getMonth(); return m >= 7 ? 0 : m <= 2 ? 1 : 2; };
          const firstPerSeason = {};
          for (const t of termStarts) {
            const s = seasonOf(t.date);
            if (!firstPerSeason[s] || t.date < firstPerSeason[s]) firstPerSeason[s] = t.date;
          }
          boundaries = Object.keys(firstPerSeason)
            .map((s) => ({ group: Number(s), date: firstPerSeason[s] }))
            .sort((a, b) => a.date.localeCompare(b.date));
        }
        for (const td of yearEvents) {
          // Bucket to the latest season boundary on or before this date.
          let group = boundaries[0]?.group ?? 0;
          for (const b of boundaries) {
            if (td.date >= b.date) group = b.group;
            else break;
          }
          if (group < termGroups.length) termGroups[group].dates.push(td);
        }
      } else {
        // Fallback: month-based bucketing. Only triggers when no
        // term_start events exist for the year (e.g. a partially-
        // imported year planner). Same boundaries as the old static
        // logic - imperfect but better than nothing.
        for (const td of yearEvents) {
          const m = new Date(td.date).getMonth();
          let idx;
          if (isCalYearCountry) {
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

  function openUpdateTermDates(school) {
    if (!school) return;
    setTermDateSchoolId(school.id);
    setTermDateSchoolName(school.school_name);
    setImportError('');
    // Shared-directory offer: has another parent at this school already
    // imported reviewed dates? Fetched async; renders a one-tap card when
    // found. Reset first so a previous school's offer never flashes.
    setDirectoryOffer(null);
    api.get(`/schools/${school.id}/directory-dates`)
      .then(({ data }) => setDirectoryOffer(data?.found ? data : null))
      .catch(() => setDirectoryOffer(null));
    setShowTermDateOptions(true);
  }

  // Open the read/edit "all term dates" modal for a specific school. Loads
  // that school's dates into the shared editTermDates state and keys the
  // modal by termDateSchoolId.
  function openViewDates(school) {
    if (!school) return;
    setTermDateSchoolId(school.id);
    setTermDateSchoolName(school.school_name);
    setEditTermDates(school.term_dates || []);
    setShowAllDates(true);
  }

  // --- Add-a-school flow -------------------------------------------------
  // Create a school WITHOUT first adding a child. UK searches the GIAS
  // directory; SA takes a free-text name. After create we refresh and drop
  // the user straight into the term-date import flow for the new school.
  async function handleAddSchoolSearch(query) {
    setAddSchoolSearch(query);
    setAddSchoolSelected(null);
    if (query.trim().length < 2) { setAddSchoolResults([]); return; }
    try {
      const { data } = await api.get(`/schools/search?q=${encodeURIComponent(query.trim())}`);
      setAddSchoolResults(data.schools || []);
    } catch { setAddSchoolResults([]); }
  }

  function openAddSchool() {
    setAddSchoolSearch('');
    setAddSchoolResults([]);
    setAddSchoolSelected(null);
    setAddSchoolSaName('');
    setAddSchoolManual(false);
    setAddSchoolManualName('');
    setAddSchoolManualPostcode('');
    setError('');
    setAddSchoolOpen(true);
  }

  async function handleCreateSchool() {
    setAddingSchool(true);
    setError('');
    try {
      let body = null;
      let reuseSchool = null;
      if (freeTextSchool) {
        if (!addSchoolSaName.trim()) { setAddingSchool(false); return; }
        body = { school_name: addSchoolSaName.trim() };
      } else if (addSchoolManual) {
        const name = addSchoolManualName.trim();
        if (!name) { setAddingSchool(false); return; }
        // Re-use an existing custom (no-URN) school of the same name rather
        // than creating a duplicate.
        reuseSchool = householdSchools.find(
          s => !s.school_urn && s.school_name.toLowerCase() === name.toLowerCase()
        );
        if (!reuseSchool) body = { school_name: name, postcode: addSchoolManualPostcode.trim() || null };
      } else {
        if (!addSchoolSelected) { setAddingSchool(false); return; }
        body = {
          school_name: addSchoolSelected.name,
          school_urn: addSchoolSelected.urn,
          school_type: addSchoolSelected.type,
          local_authority: addSchoolSelected.local_authority,
          postcode: addSchoolSelected.postcode,
        };
      }
      let createdId = reuseSchool?.id;
      if (body) {
        const { data } = await api.post('/schools', body);
        createdId = data.school?.id;
      }
      const fresh = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(fresh);
      setAddSchoolOpen(false);
      if (laHandoff) dismissLaHandoff();   // council handoff fulfilled
      const newSchool = fresh.find(s => s.id === createdId) || reuseSchool;
      if (newSchool?.id) openUpdateTermDates(newSchool);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the school.');
    } finally {
      setAddingSchool(false);
    }
  }

  async function handleUpdateTermDate(dateId) {
    if (!editTermDateFields.date) return;
    setSavingTermDateEdit(true);
    try {
      await api.patch(`/schools/${termDateSchoolId}/term-dates/${dateId}`, editTermDateFields);
      // Refresh term dates
      const { data } = await api.get(`/schools/${termDateSchoolId}/term-dates`);
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

  // Bulk-clear every term date for a school. Country-agnostic - the
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

  async function handleSyncIcal(school) {
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


  // ── Teaser: no dependent children yet ──────────────────────────────
  const laBanner = laHandoff ? (
    <div className="flex items-start gap-3 bg-plum-light text-plum rounded-xl px-4 py-3">
      <IconCalendar className="h-4 w-4 shrink-0 mt-0.5" />
      <p className="text-sm min-w-0 flex-1">
        You were reading <span className="font-semibold">{laDisplayName(laHandoff)}</span> term
        dates — add your school below and they&apos;ll drop straight onto the family calendar.
      </p>
      <button onClick={dismissLaHandoff} aria-label="Dismiss" className="shrink-0 font-semibold hover:opacity-70">×</button>
    </div>
  ) : null;

  // Sell the feature instead of showing empty scaffolding; the CTA takes
  // the user to Family to add their children first.
  if (!hasChildren) {
    return (
      <div className="max-w-[1080px] mx-auto space-y-6 pb-24">
        <PageHeader title="School" />
        {laBanner}
        <div className="bg-white rounded-[18px] border border-light-grey p-6 md:p-8" style={{ boxShadow: CARD_SHADOW }}>
          <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center mb-4 bg-plum-light text-plum">
            <IconGraduation className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold text-charcoal">Term dates, sorted for the whole family</h2>
          <p className="text-sm text-[var(--ink-2)] mt-1.5 max-w-[560px] leading-relaxed">
            Add your children and Housemait keeps school life on autopilot:
          </p>
          <ul className="mt-4 space-y-2.5 max-w-[560px]">
            {[
              ['Term dates on the family calendar', 'Half terms, INSET days and holidays imported once and visible to everyone.'],
              ['Activity reminders that pause in the holidays', 'After-school clubs and pickups only nudge you while term is running.'],
              ['A shared term-dates directory', "If another parent at your school has already imported the dates, you get them in one tap."],
            ].map(([title, sub]) => (
              <li key={title} className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: SOFT }}>
                <IconCalendar className="h-4 w-4 shrink-0 mt-0.5 text-plum" />
                <span className="text-sm text-charcoal min-w-0">
                  <span className="font-semibold">{title}</span>
                  <span className="block text-xs text-warm-grey mt-0.5">{sub}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/family"
            className="inline-block mt-6 bg-plum hover:bg-plum/90 text-white font-semibold px-7 py-3 rounded-[14px] text-[15px] transition-colors"
            style={{ boxShadow: '0 2px 8px rgba(109,56,173,0.3)' }}
          >
            Add your children
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1080px] mx-auto space-y-6 pb-24">
      <PageHeader
        title="School"
        actions={isAdmin && (
          <PillBtn icon={<IconPlus className="h-3.5 w-3.5" />} onClick={openAddSchool}>Add a school</PillBtn>
        )}
      />

      {laBanner}
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {success && (
        <p className="text-sm text-sage bg-sage-light rounded-xl px-3 py-2">{success}</p>
      )}
      {/* Win-moment referral nudge - only after a successful term-dates
          import (and only inside the pilot; the component gates itself). */}
      <ReferralNudge show={termWin} context="school" />

      {/* Schools - manage each school and its term dates here (decoupled
          from individual children, for privacy). */}
      <section>
        <p className="text-sm text-[var(--ink-2)] mb-4 max-w-[560px]">
          Import term dates once and Housemait keeps half-term reminders and
          term-only activities in sync for everyone at that school.
        </p>
        {householdSchools.length === 0 ? (
          <div className="rounded-[18px] border-[1.5px] border-dashed border-light-grey p-8 text-center">
            <p className="text-sm text-warm-grey mb-3">No schools added yet.</p>
            {isAdmin ? (
              <button onClick={openAddSchool} className="text-sm font-semibold text-plum hover:text-plum/80">+ Add a school</button>
            ) : (
              <p className="text-xs text-warm-grey">Ask a household admin to add one.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))' }}>
            {householdSchools.map((school) => {
              const dates = school.term_dates || [];
              const summary = getTermSummary(dates);
              const childNames = (school.children || []).map(c => c.name).filter(Boolean);
              const sourceLabel = { local_authority: 'Local authority', school_website: 'School website', website_scrape: 'School website', school_directory: 'School directory', ical: 'iCal feed', ical_import: 'iCal feed', sa_national: 'National calendar', 'sa-national': 'National calendar', whatsapp_import: 'WhatsApp', manual: 'Manual' }[school.term_dates_source] || school.term_dates_source;
              const colour = school.colour || '#6B3FA0';
              // Next break: the soonest future half-term / holiday in the
              // imported dates, shown as the brand-soft reminder line.
              const todayYmdStr = new Date().toLocaleDateString('en-CA');
              const breakRow = dates
                .filter(d => /half_term|holiday|break/i.test(d.event_type || '') && (d.date || '') >= todayYmdStr)
                .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
              const brk = breakRow
                ? `${breakRow.label || 'Half-term'} ${formatDateShort(breakRow.date)}${breakRow.end_date ? `–${formatDateShort(breakRow.end_date)}` : ''}`
                : null;
              return (
                <div key={school.id} className="bg-white rounded-[18px] border border-light-grey p-5 flex flex-col gap-4" style={{ boxShadow: CARD_SHADOW }}>
                  <div className="flex items-start gap-3.5">
                    <button
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => setColourPickerFor(colourPickerFor === school.id ? null : school.id)}
                      title={isAdmin ? 'Change this school’s colour' : undefined}
                      aria-label={isAdmin ? `Change ${school.school_name}'s colour` : undefined}
                      className="w-[46px] h-[46px] rounded-[13px] shrink-0 flex items-center justify-center border-0"
                      style={{ background: colour + '1F', color: colour, cursor: isAdmin ? 'pointer' : 'default' }}
                    >
                      <IconGraduation className="h-6 w-6" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-charcoal truncate">{school.school_name}</div>
                      <div className="text-xs text-warm-grey mt-0.5 truncate">
                        {[school.local_authority, childNames.length ? childNames.join(', ') : null].filter(Boolean).join(' · ') || 'No children linked'}
                      </div>
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleRemoveHouseholdSchool(school.id)} className="text-xs font-semibold text-warm-grey hover:text-coral shrink-0">Remove</button>
                    )}
                  </div>

                  {colourPickerFor === school.id && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-warm-grey mr-1">Colour</span>
                      {SCHOOL_COLOURS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => handleSetSchoolColour(school.id, hex)}
                          aria-label={`Use this colour for ${school.school_name}`}
                          className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                          style={{ background: hex, border: colour === hex ? '2.5px solid #2D2A33' : '2.5px solid transparent' }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold text-charcoal whitespace-nowrap" style={{ background: SOFT }}>
                      <IconCalendar className="h-3.5 w-3.5 text-warm-grey" />
                      {summary.start && summary.end ? `Term · ${formatDateShort(summary.start)} – ${formatDateShort(summary.end)}` : (dates.length ? `${dates.length} date${dates.length === 1 ? '' : 's'} saved` : 'No term dates yet')}
                    </span>
                    {sourceLabel && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold text-charcoal whitespace-nowrap" style={{ background: SOFT }}>
                        <IconMessageCircle className="h-3.5 w-3.5 text-warm-grey" />
                        {sourceLabel}
                      </span>
                    )}
                  </div>

                  {/* GIAS says independent, but the saved dates came from the
                      council - the exact wrong-import the stepped sheet now
                      prevents, surfaced for households who did it under the
                      old six-option sheet. Shown to every member (management
                      is deliberately shared here), because whoever notices
                      first should be able to fix it. */}
                  {/independent/i.test(school.school_type || '') && dates.some(d => d.source === 'local_authority') && (
                    <div className="px-3.5 py-2.5 rounded-[11px] text-xs" style={{ background: '#FBF1DE', color: '#8A5F1E' }}>
                      <span className="font-semibold">These dates may be wrong.</span>{' '}
                      {school.school_name} is an independent school and sets its own term dates, but the dates on
                      your calendar came from {school.local_authority ? `${school.local_authority} Council` : 'the local council'}.
                      <button onClick={() => openUpdateTermDates(school)} className="block mt-1.5 font-bold underline">
                        Review the dates
                      </button>
                    </div>
                  )}

                  {brk && (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[11px] text-xs font-semibold bg-plum-light text-plum">
                      <IconBell className="h-3.5 w-3.5" />
                      Next break · {brk}
                    </div>
                  )}

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <button onClick={() => openUpdateTermDates(school)} className="text-xs font-semibold text-plum hover:text-plum/80">
                        {dates.length > 0 ? 'Update dates' : 'Import dates'}
                      </button>
                      {dates.length > 0 && (
                        <button onClick={() => openViewDates(school)} className="text-xs font-medium text-warm-grey hover:text-charcoal">View all dates</button>
                      )}
                      {school.ical_url && (
                        <button onClick={() => handleSyncIcal(school)} disabled={syncingIcal} className="text-xs font-medium text-warm-grey hover:text-charcoal disabled:opacity-50">{syncingIcal ? 'Syncing…' : 'Sync iCal'}</button>
                      )}
                      {dates.length > 0 && (
                        <button onClick={() => handleClearAllTermDates(school.id)} disabled={clearingTermDates} className="text-xs font-medium text-warm-grey hover:text-coral disabled:opacity-50">Clear all</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add-a-school modal (create a school without first adding a child).
          UK = GIAS directory search; SA = free-text name. */}
      {addSchoolOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setAddSchoolOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base md:text-medium font-semibold text-bark mb-1">Add a school</h2>
            <p className="text-xs text-cocoa mb-4">{freeTextSchool ? 'Enter the school name. You can add term dates next.' : 'Search the UK schools directory. You can import term dates next.'}</p>
            {freeTextSchool ? (
              <div>
                <label className="block text-xs font-medium text-cocoa mb-1">School name</label>
                <input
                  type="text"
                  value={addSchoolSaName}
                  onChange={(e) => setAddSchoolSaName(e.target.value)}
                  placeholder="e.g. Sandown Primary"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                />
              </div>
            ) : addSchoolManual ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-cocoa mb-1">School name</label>
                  <input
                    type="text"
                    value={addSchoolManualName}
                    onChange={(e) => setAddSchoolManualName(e.target.value)}
                    placeholder="e.g. The Sunshine Academy"
                    autoFocus
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-cocoa mb-1">Postcode <span className="font-normal text-cocoa/70">(optional)</span></label>
                  <input
                    type="text"
                    value={addSchoolManualPostcode}
                    onChange={(e) => setAddSchoolManualPostcode(e.target.value)}
                    placeholder="SW1A 1AA"
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                  />
                </div>
                <p className="text-[11px] text-cocoa">We&apos;ll set this up as a custom school. Local-authority term dates aren&apos;t available for it, but you can import from the school&apos;s website, a PDF or iCal feed, or add term dates by hand.</p>
                <button type="button" onClick={() => setAddSchoolManual(false)} className="text-xs text-primary hover:text-primary-pressed font-medium">← Back to search</button>
              </div>
            ) : (
              <div className="relative">
                <label className="block text-xs font-medium text-cocoa mb-1">Search for your school</label>
                <input
                  type="text"
                  value={addSchoolSearch}
                  onChange={(e) => handleAddSchoolSearch(e.target.value)}
                  placeholder="Search by name or postcode..."
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                />
                {addSchoolResults.length > 0 && !addSchoolSelected && (
                  <ul className="absolute z-10 w-full bg-white border border-cream-border rounded-lg mt-1 max-h-56 overflow-y-auto shadow-lg">
                    {addSchoolResults.map((s) => (
                      <li key={s.urn}>
                        <button
                          onClick={() => { setAddSchoolSelected(s); setAddSchoolSearch(s.name); setAddSchoolResults([]); }}
                          className="w-full text-left px-4 py-2 hover:bg-sand transition-colors"
                        >
                          <p className="text-sm text-bark">{s.name}</p>
                          <p className="text-xs text-cocoa">{[s.local_authority, s.postcode].filter(Boolean).join(' · ')}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {addSchoolSelected && (
                  <p className="text-xs text-sage mt-2">Selected: {addSchoolSelected.name}</p>
                )}
                {!addSchoolSelected && (
                  <button
                    type="button"
                    onClick={() => { setAddSchoolManual(true); setAddSchoolManualName(addSchoolSearch.trim()); setAddSchoolResults([]); }}
                    className="mt-2 text-xs text-primary hover:text-primary-pressed font-medium"
                  >
                    Can&apos;t find your school? Add it manually →
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAddSchoolOpen(false)} className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors text-sm">Cancel</button>
              <button
                onClick={handleCreateSchool}
                disabled={addingSchool || (freeTextSchool ? !addSchoolSaName.trim() : (addSchoolManual ? !addSchoolManualName.trim() : !addSchoolSelected))}
                className="flex-1 bg-primary text-white font-semibold py-2.5 rounded-2xl hover:bg-primary-pressed transition-colors disabled:opacity-50 text-sm"
              >
                {addingSchool ? 'Adding…' : 'Add school'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activities - everyone's after-school clubs in one place (data stays
          per-child; this is just one front door). Add/edit happens in the
          activity modal below. */}
      {(() => {
        const activityKids = members.filter(m => m.member_type === 'dependent' || m.school_id);
        const sortByDayTime = (list) => list.slice().sort(
          (a, b) => (a.day_of_week - b.day_of_week) || ((a.time_start || '').localeCompare(b.time_start || '')),
        );
        // One row per club occurrence, sorted by weekday then time (matches the
        // design). day pill + kid-colour glyph tile + name + time + pickup.
        const renderRow = (kid, a, dim) => {
          const kidColor = hexFor(kid);
          const Glyph = ACTIVITY_ICONS[iconFor(a.activity)] || ACTIVITY_ICONS.star;
          // Two-line stack matching the dashboard Extracurricular card: start
          // time over a faded end time, no dash. Falls back to whichever single
          // time exists when only one is set.
          const start = a.time_start ? a.time_start.substring(0, 5) : '';
          const end = a.time_end ? a.time_end.substring(0, 5) : '';
          const topTime = start || end;
          const showEnd = start && end;
          const timeLabel = showEnd ? `${start} to ${end}` : topTime;
          const pickup = a.pickup_member_id ? members.find(m => m.id === a.pickup_member_id) : null;
          const dayLabel = DAY_LABELS[a.day_of_week];
          return (
            <button
              key={a.id}
              type="button"
              onClick={isAdmin ? () => openEditActivity(kid, a) : undefined}
              disabled={!isAdmin}
              aria-label={`${a.activity}, ${dayLabel}${timeLabel ? `, ${timeLabel}` : ''}${pickup ? `, pickup ${pickup.name}` : ''}`}
              className={`w-full flex items-center gap-4 px-5 py-3 text-left transition-colors ${isAdmin ? 'hover:bg-[#F3EEE5]' : 'cursor-default'} ${dim ? 'opacity-60' : ''}`}
              style={{ borderTop: '1px solid var(--color-light-grey)' }}
            >
              <span className="w-[46px] shrink-0 text-center py-[5px] rounded-lg text-[11px] font-semibold tracking-[0.04em] text-warm-grey" style={{ background: SOFT }}>
                {dayLabel}
              </span>
              <span className="w-[35px] h-[35px] rounded-[11px] shrink-0 flex items-center justify-center" style={{ background: kidColor + '1F' }}>
                <Glyph size={20} color={kidColor} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-charcoal truncate">{a.activity}</span>
                {dim && a.term_label && <span className="block text-xs text-warm-grey truncate">{a.term_label}</span>}
              </span>
              {topTime && (
                <span className="shrink-0" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                  <span className="block" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>{topTime}</span>
                  {showEnd && <span className="block" style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-2)', opacity: 0.6 }}>{end}</span>}
                </span>
              )}
              {pickup && (
                <span className="flex items-center gap-2 pl-3 shrink-0" style={{ borderLeft: '1px solid var(--color-light-grey)' }}>
                  <PickupCar className="h-3.5 w-3.5 text-warm-grey" />
                  <Avatar member={pickup} size={24} />
                  <span className="text-xs font-semibold text-warm-grey whitespace-nowrap hidden sm:inline">{pickup.name}</span>
                </span>
              )}
            </button>
          );
        };
        return (
          <section>
            <h2 className="text-lg font-semibold text-charcoal mb-0.5">Extracurricular Activities</h2>
            <p className="text-sm text-[var(--ink-2)] mb-4">Everyone&apos;s after-school clubs in one place — times and who&apos;s on pickup.</p>
            {loadingMembers ? <Spinner /> : activityKids.length === 0 ? (
              <p className="text-sm text-warm-grey">Add a child to start tracking after-school activities.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {activityKids.map((kid) => {
                  const acts = childActivities[kid.id] || [];
                  const active = sortByDayTime(acts.filter(activityActiveToday));
                  const other = sortByDayTime(acts.filter(a => !activityActiveToday(a)));
                  const clubCount = active.length + other.length;
                  return (
                    <div key={kid.id} className="bg-white rounded-[18px] border border-light-grey overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
                      <div className="flex items-center gap-3 px-5 py-4">
                        <Avatar member={kid} size={36} />
                        <span className="text-base font-semibold text-charcoal truncate">{kid.name}</span>
                        <span className="text-xs text-warm-grey font-medium">{clubCount} {clubCount === 1 ? 'club' : 'clubs'}</span>
                        <div className="flex-1" />
                        {isAdmin && (
                          <button onClick={() => openAddActivity(kid)} className="text-xs font-semibold text-plum hover:text-plum/80 shrink-0">+ Add</button>
                        )}
                      </div>
                      {clubCount === 0 ? (
                        <div className="px-5 pb-5 -mt-1.5 text-xs text-warm-grey italic">No clubs yet.</div>
                      ) : active.length > 0 ? (
                        active.map(a => renderRow(kid, a, false))
                      ) : (
                        <div className="px-5 pb-2 -mt-1.5 text-xs text-warm-grey">No activities running this term.</div>
                      )}
                      {other.length > 0 && (() => {
                        // "Start new term" / "Clear" act only on FINISHED
                        // activities. `other` also holds future-dated ones
                        // (start_date ahead of today) - those are already
                        // sorted for next term and must survive both actions.
                        const todayYmd = new Date().toISOString().slice(0, 10);
                        const finished = other.filter((a) => a.end_date && a.end_date < todayYmd);
                        return (
                          <>
                            <div className="flex items-center px-5 pt-3 pb-1" style={{ borderTop: '1px solid var(--color-light-grey)' }}>
                              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warm-grey">Other terms</span>
                              {isAdmin && finished.length > 0 && (
                                <>
                                  <div className="flex-1" />
                                  <button onClick={() => setNewTermModal({ kid, activities: finished })} className="text-[11px] font-semibold text-plum hover:text-plum/80 shrink-0">Start new term</button>
                                  <button onClick={() => clearExpiredActivities(kid, finished.length)} className="ml-3 text-[11px] font-semibold text-warm-grey hover:text-coral shrink-0">Clear</button>
                                </>
                              )}
                            </div>
                            {other.map(a => renderRow(kid, a, true))}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* Activity add/edit modal - the shared form (also used by the
          Calendar's activity sheet). Owns its own state + API calls;
          onChanged refreshes the Activities card. */}
      {activityModal && (
        <ActivityModal
          child={activityModal.child}
          activity={activityModal.activity}
          members={members}
          onClose={() => setActivityModal(null)}
          onChanged={loadActivities}
        />
      )}

      {/* Start-of-term rollover: tick-list of last term's activities, moved
          into a new window in one action. Mounted only while open. */}
      {newTermModal && (
        <NewTermModal
          kid={newTermModal.kid}
          activities={newTermModal.activities}
          school={householdSchools.find((s) => s.id === newTermModal.kid.school_id) || null}
          onClose={() => setNewTermModal(null)}
          onDone={() => { setNewTermModal(null); loadActivities(); }}
        />
      )}

      {/* The stepped term-dates import: one decision per screen, routed by
          school type, with a mandatory preview. Mounted only while open so
          every opening starts from a clean slate rather than the last
          parent's half-finished import. */}
      {showTermDateOptions && termDateSchoolId && (
        <TermDatesSheet
          open
          school={householdSchools.find((s) => s.id === termDateSchoolId) || { id: termDateSchoolId, school_name: termDateSchoolName }}
          sharedDates={directoryOffer?.found ? {
            count: directoryOffer.school.date_count || 0,
            year_label: (directoryOffer.school.academic_years || []).join(', '),
            // Only a human check earns "checked <date>" - an import is not a
            // verification, and the card must not imply someone looked.
            verified_at: directoryOffer.school.last_verified_at || null,
          } : null}
          country={household?.country}
          onClose={() => setShowTermDateOptions(false)}
          onImported={async () => {
            setSuccess('Term dates added.');
            setTermWin(true);
            setTimeout(() => setSuccess(''), 3000);
            setDirectoryOffer(null);
            await loadSchools();
          }}
          onReview={setDraftImport}
        />
      )}

      {/* Review Imported Dates Panel - opens after /import-website/preview
          returns. Admin can edit any row, delete rows, and only commits
          to the DB on Save. Each row shows yellow warning chips from the
          server-side validator and an info button revealing the AI's
          source quote. */}
      {draftImport && (
        <BottomSheet open onDismiss={() => { if (!savingDraftImport) setDraftImport(null); }} desktopWidthClass="sm:w-[672px]">
          <div className="overflow-y-auto min-h-0 p-6 pt-1">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base md:text-lg font-medium text-bark">Review imported dates</h2>
              <button onClick={() => setDraftImport(null)} disabled={savingDraftImport} className="text-cocoa hover:text-bark p-1 disabled:opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-cocoa mb-1">{draftImport.schoolName}</p>
            <p className="text-sm text-cocoa mb-4">
              We found <span className="font-medium text-bark">{draftImport.dates.length}</span> proposed date{draftImport.dates.length === 1 ? '' : 's'}. Check each row - especially any with yellow warnings - then tap Save.
            </p>

            {importError && (
              <div className="bg-coral/10 border border-coral/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-sm text-bark font-medium whitespace-pre-line">{importError}</p>
              </div>
            )}

            <div className="space-y-2">
              {draftImport.dates.map((d) => {
                // Only half-term and bank-holiday rows can span a
                // range. For single-day events (term start/end, INSET)
                // showing a 'to' field invites confusion ("what do I
                // put for term_start's end date?"). Hide it.
                const TYPE_LABELS = { term_start: 'Term starts', term_end: 'Term ends', half_term_start: 'Half term', inset_day: 'INSET Day', bank_holiday: 'Holiday / closure' };
                const hasWarnings = Array.isArray(d.warnings) && d.warnings.length > 0;
                const isQuoteOpen = showSourceQuoteFor === d._id;
                const isRange = d.event_type === 'half_term_start' || d.event_type === 'bank_holiday';
                return (
                  <div key={d._id} className={`bg-white rounded-lg border ${hasWarnings ? 'border-coral/40' : 'border-cream-border'} p-3`}>
                    <div className="flex items-start gap-2 flex-wrap">
                      <select
                        value={d.event_type}
                        onChange={(e) => {
                          const next = e.target.value;
                          // Switching away from a range type — drop
                          // the stale end_date so it doesn't sneak
                          // into the saved record.
                          const patch = { event_type: next };
                          if (next !== 'half_term_start' && next !== 'bank_holiday') patch.end_date = null;
                          updateDraftRow(d._id, patch);
                        }}
                        className="border border-cream-border rounded px-1.5 py-1 text-xs bg-white"
                      >
                        {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input
                        type="date"
                        value={d.date || ''}
                        onChange={(e) => updateDraftRow(d._id, { date: e.target.value })}
                        className="border border-cream-border rounded px-2 py-1 text-xs bg-white"
                        title={isRange ? 'From' : 'Date'}
                      />
                      {isRange && (
                        <>
                          <span className="text-cocoa text-xs self-center">to</span>
                          <input
                            type="date"
                            value={d.end_date || ''}
                            onChange={(e) => updateDraftRow(d._id, { end_date: e.target.value })}
                            className="border border-cream-border rounded px-2 py-1 text-xs bg-white"
                            title="To (optional)"
                          />
                        </>
                      )}
                      <input
                        type="text"
                        value={d.label || ''}
                        onChange={(e) => updateDraftRow(d._id, { label: e.target.value })}
                        placeholder="Label"
                        className="flex-1 min-w-[120px] border border-cream-border rounded px-2 py-1 text-xs bg-white"
                      />
                      <div className="flex items-center gap-1 ml-auto">
                        {d.source_quote && (
                          <button
                            onClick={() => setShowSourceQuoteFor(isQuoteOpen ? null : d._id)}
                            className={`text-xs px-1.5 py-0.5 rounded ${isQuoteOpen ? 'bg-plum-light text-plum' : 'text-cocoa hover:text-plum'}`}
                            title="Show source quote"
                            type="button"
                          >ⓘ</button>
                        )}
                        <button onClick={() => removeDraftRow(d._id)} className="text-error/60 hover:text-error p-0.5" title="Remove from import" type="button">🗑</button>
                      </div>
                    </div>
                    {hasWarnings && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {d.warnings.map((w, wi) => (
                          <span key={wi} className="inline-block bg-coral-light text-coral text-[11px] font-medium px-2 py-0.5 rounded-full">
                            ⚠ {w}
                          </span>
                        ))}
                      </div>
                    )}
                    {isQuoteOpen && d.source_quote && (
                      <div className="mt-2 text-[11px] text-cocoa bg-oat border border-cream-border rounded px-2 py-1.5 italic break-words">
                        &ldquo;{d.source_quote}&rdquo;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-cream-border">
              <button
                onClick={() => setDraftImport(null)}
                disabled={savingDraftImport}
                className="text-sm text-cocoa hover:text-bark px-3 py-2 disabled:opacity-50"
                type="button"
              >Cancel</button>
              <button
                onClick={handleConfirmImportWebsite}
                disabled={savingDraftImport || draftImport.dates.length === 0}
                className="text-sm bg-primary text-white font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50"
                type="button"
              >
                {savingDraftImport ? 'Saving…' : `Save ${draftImport.dates.length} date${draftImport.dates.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {/* View & Edit All Dates Panel */}
      {showAllDates && termDateSchoolId && (
        <BottomSheet open onDismiss={() => setShowAllDates(false)} desktopWidthClass="sm:w-[512px]">
          <div className="overflow-y-auto min-h-0 p-6 pt-1">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base md:text-lg font-medium text-bark">All term dates</h2>
              <button onClick={() => setShowAllDates(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-cocoa mb-4">{termDateSchoolName}</p>

            {(() => {
              const grouped = groupDatesByTerm(editTermDates, household?.country);
              const academicYears = Object.keys(grouped).sort();
              // Labels for rendering — half_term_end stays in the map
              // so existing rows of that type (older imports / iCal
              // feeds) still display with a friendly label rather than
              // a raw "half_term_end" string. The picker filters this
              // map down to the recommended set for new entries.
              const TYPE_LABELS = { term_start: 'Term starts', term_end: 'Term ends', half_term_start: 'Half term', half_term_end: 'Half term ends', inset_day: 'INSET Day', bank_holiday: 'Holiday / closure' };
              const PICKER_TYPES = ['term_start', 'term_end', 'half_term_start', 'inset_day', 'bank_holiday'];
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
                              <div className="text-[10px] font-semibold text-cocoa uppercase tracking-wider mb-1.5 border-b border-cream-border pb-1">{heading}</div>
                              <div className="space-y-1">
                                {termDates.map(td => (
                                  <div key={td.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white group text-xs">
                                    {editingTermDate === td.id ? (
                                      (() => {
                                        // Same range-vs-single rule as
                                        // the import-review panel and
                                        // the manual-add form: only
                                        // half-term and bank-holiday
                                        // can span multiple days, so
                                        // hide the 'to' field for the
                                        // single-day types and label
                                        // the lone field 'Date'.
                                        const editType = editTermDateFields.event_type || td.event_type;
                                        const isRange = editType === 'half_term_start' || editType === 'bank_holiday';
                                        return (
                                          <div className="flex-1 space-y-1.5">
                                            <div className="flex gap-2">
                                              <select
                                                value={editType}
                                                onChange={(e) => {
                                                  const next = e.target.value;
                                                  setEditTermDateFields(prev => {
                                                    const patch = { ...prev, event_type: next };
                                                    if (next !== 'half_term_start' && next !== 'bank_holiday') patch.end_date = null;
                                                    return patch;
                                                  });
                                                }}
                                                className="border border-cream-border rounded px-1.5 py-1 text-xs bg-white"
                                              >
                                                {PICKER_TYPES.map(k => <option key={k} value={k}>{TYPE_LABELS[k]}</option>)}
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
                                                title={isRange ? 'From' : 'Date'}
                                              />
                                              {isRange && (
                                                <>
                                                  <span className="text-cocoa">to</span>
                                                  <input
                                                    type="date"
                                                    value={editTermDateFields.end_date ?? td.end_date ?? ''}
                                                    onChange={(e) => setEditTermDateFields(prev => ({ ...prev, end_date: e.target.value }))}
                                                    className="border border-cream-border rounded px-2 py-1 text-xs bg-white"
                                                    title="To (optional)"
                                                  />
                                                </>
                                              )}
                                              <div className="flex-1" />
                                              <button onClick={() => { setEditingTermDate(null); setEditTermDateFields({}); }} className="text-xs text-cocoa">Cancel</button>
                                              <button onClick={() => handleUpdateTermDate(td.id)} disabled={savingTermDateEdit} className="text-xs bg-primary text-white px-2 py-1 rounded font-medium disabled:opacity-50">
                                                {savingTermDateEdit ? 'Saving...' : 'Save'}
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })()
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
                        <select value={termDateType} onChange={(e) => { setTermDateType(e.target.value); if (e.target.value !== 'half_term_start' && e.target.value !== 'bank_holiday') setTermDateEndDate(''); }} className="border border-cream-border rounded-lg px-2 py-2 text-xs bg-white">
                          <option value="term_start">Term start</option>
                          <option value="term_end">Term end</option>
                          <option value="half_term_start">Half term</option>
                          <option value="inset_day">INSET day</option>
                          <option value="bank_holiday">Holiday / closure</option>
                        </select>
                        <input type="text" value={termDateLabel} onChange={(e) => setTermDateLabel(e.target.value)} placeholder="Label (optional)" className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-xs bg-white" />
                      </div>
                      {/* Half term and bank holidays can span multiple
                          days; everything else is single-date. Showing
                          the end-date field only for the range types
                          avoids the "what does 'to' mean for Term
                          start?" confusion. */}
                      {(() => {
                        const isRange = termDateType === 'half_term_start' || termDateType === 'bank_holiday';
                        return (
                          <div className="flex gap-2 items-center">
                            <div className="flex flex-col">
                              <label className="text-[10px] text-cocoa mb-0.5">{isRange ? 'From' : 'Date'}</label>
                              <input type="date" value={termDateDate} onChange={(e) => setTermDateDate(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                            </div>
                            {isRange && (
                              <div className="flex flex-col">
                                <label className="text-[10px] text-cocoa mb-0.5">To (optional)</label>
                                <input type="date" value={termDateEndDate} onChange={(e) => setTermDateEndDate(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-xs bg-white" />
                              </div>
                            )}
                            <div className="flex-1" />
                            <button onClick={() => { setShowAddTermDate(false); setTermDateEndDate(''); }} className="text-xs text-cocoa self-end pb-1.5">Cancel</button>
                            <button onClick={handleAddTermDate} disabled={savingTermDate || !termDateDate} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 self-end">
                              {savingTermDate ? 'Adding...' : 'Add'}
                            </button>
                          </div>
                        );
                      })()}
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
        </BottomSheet>
      )}
    </div>
  );
}

/**
 * Start-of-term rollover. Takes a child's FINISHED activities and moves the
 * ticked ones into a new term window in one action - same days, times and
 * pickup people, new dates. The window prefills from the child's school's
 * next term (first term_start after today plus its term_end) when the school
 * holds future dates; everything stays editable because the guess can be
 * wrong (a club term rarely matches the school term exactly).
 */
function NewTermModal({ kid, activities, school, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10);
  const termDates = school?.term_dates || [];
  const nextStart = termDates
    .filter((d) => d.event_type === 'term_start' && d.date > today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const nextEnd = nextStart
    ? termDates
        .filter((d) => d.event_type === 'term_end' && d.date > nextStart.date)
        .sort((a, b) => a.date.localeCompare(b.date))[0] || null
    : null;
  const seasonOf = (ymd) => {
    const m = Number(ymd.slice(5, 7));
    return m >= 8 ? 'Autumn' : m <= 4 ? 'Spring' : 'Summer';
  };
  const defaultLabel = nextStart
    ? `${seasonOf(nextStart.date)} Term${nextStart.academic_year ? ` ${nextStart.academic_year}` : ''}`
    : '';

  const [startDate, setStartDate] = useState(nextStart?.date || '');
  const [endDate, setEndDate] = useState(nextEnd?.date || '');
  const [label, setLabel] = useState(defaultLabel);
  const [ticked, setTicked] = useState(() => new Set(activities.map((a) => a.id)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const NT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const toggleTick = (id) => setTicked((t) => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const valid = startDate && endDate && startDate < endDate && ticked.size > 0;

  async function apply() {
    if (!valid || saving) return;
    setSaving(true);
    setErr('');
    try {
      for (const a of activities) {
        if (!ticked.has(a.id)) continue;
        await api.patch(`/schools/activities/${a.id}`, {
          start_date: startDate,
          end_date: endDate,
          term_label: label.trim() || null,
        });
      }
      onDone();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not update the activities.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-charcoal mb-1">Start new term — {kid.name}</h3>
        <p className="text-sm text-warm-grey mb-4">
          Tick the clubs carrying on. Same days, times and pickups — just new dates.
        </p>

        <label className="block text-xs font-semibold text-charcoal mb-1">Term name</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Autumn Term 2026-2027"
          className="w-full h-11 px-3 rounded-[10px] border-[1.5px] border-light-grey bg-cream text-sm mb-3 focus:outline-none focus:border-plum"
        />
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-charcoal mb-1">First week</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-11 px-3 rounded-[10px] border-[1.5px] border-light-grey bg-cream text-sm focus:outline-none focus:border-plum" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-charcoal mb-1">Last week</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-11 px-3 rounded-[10px] border-[1.5px] border-light-grey bg-cream text-sm focus:outline-none focus:border-plum" />
          </div>
        </div>

        <div className="rounded-xl border border-light-grey divide-y divide-light-grey mb-4">
          {activities.map((a) => (
            <label key={a.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ticked.has(a.id)}
                onChange={() => toggleTick(a.id)}
                className="h-4 w-4 accent-[var(--color-plum,#6B3FA0)]"
              />
              <span className="flex-1 text-sm text-charcoal truncate">{a.activity}</span>
              <span className="text-xs text-warm-grey shrink-0">
                {NT_DAYS[a.day_of_week] || ''}{a.time_start ? ` ${String(a.time_start).slice(0, 5)}` : ''}
              </span>
            </label>
          ))}
        </div>

        {err && <p className="text-sm text-coral mb-3">{err}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl border-[1.5px] border-light-grey text-sm font-semibold text-charcoal">
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!valid || saving}
            className="flex-1 h-12 rounded-xl bg-plum text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? 'Moving…' : `Move ${ticked.size} ${ticked.size === 1 ? 'club' : 'clubs'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
