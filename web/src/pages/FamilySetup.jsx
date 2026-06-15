import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import {
  IconUsers, IconHome, IconMail, IconEdit, IconMapPin, IconCameraSimple,
  IconPlus, IconBell, IconGraduation, IconMessageCircle, IconCalendar, IconTrash,
} from '../components/Icons';
import { useCanWrite } from '../context/SubscriptionContext';
import { isUkHousehold, isSouthAfricaHousehold, hasSchoolsFeature } from '../lib/country';
import SubscribePrompt from '../components/SubscribePrompt';
import { loadCached } from '../lib/offlineCache';
import { pickPhoto } from '../lib/photo-picker';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { ACTIVITY_ICONS, iconFor } from '../lib/activityIcons';

// Soft warm sand for inset chips / day pills (shared literal across the
// redesigned pages - no exact theme token for this neutral).
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

// Small pickup-car glyph for the Activities rows.
function PickupCar({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13v5h-2.5M3 13v5h2.5M3 13h18" />
      <circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

// Render the household name as "The {X} family", tolerating names that already
// carry "The " and/or "family" so we never double them up.
function familyTitle(name) {
  const raw = (name || '').trim();
  if (!raw) return 'Your household';
  const core = raw.replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim();
  return core ? `The ${core} family` : raw;
}

// Role pill: colour by tier (admin / parent / dependent), but the LABEL comes
// from the member's own family_role (Father, Mother, Child, Gran…) so we don't
// assume "Kid"/"Parent" - a grandparent added under dependents reads "Gran",
// not "Kid". Falls back to the tier name only when family_role is blank.
// Admins keep an "· Admin" suffix so the badge still flags them.
function roleMeta(m) {
  const isAdmin = m.role === 'admin';
  const tier = isAdmin
    ? { cls: 'bg-plum-light text-plum' }
    : (m.member_type === 'dependent'
      ? { cls: 'text-warm-grey', style: { background: SOFT } }
      : { cls: 'bg-sage-light text-sage' });
  const fallback = isAdmin ? 'Admin' : (m.member_type === 'dependent' ? 'Kid' : 'Parent');
  const role = (m.family_role || '').trim();
  let label;
  if (isAdmin) {
    label = role && !/admin/i.test(role) ? `${role} · Admin` : (role || 'Admin');
  } else {
    label = role || fallback;
  }
  return { label, ...tier };
}

// Centred member card (avatar + name + role + role pill), with edit/remove
// on hover. The role pill carries a text label (not colour alone) for a11y.
function MemberCard({ m, canEdit, canRemove, onEdit, onRemove, removing }) {
  const rm = roleMeta(m);
  return (
    <div
      className="group relative bg-white rounded-[18px] border border-light-grey px-5 py-[22px] flex flex-col items-center text-center gap-3"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {(canEdit || canRemove) && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {canEdit && (
            <button onClick={onEdit} aria-label={`Edit ${m.name}`} className="p-1.5 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors">
              <IconEdit className="h-3.5 w-3.5" />
            </button>
          )}
          {canRemove && (
            <button onClick={onRemove} disabled={removing} aria-label={`Remove ${m.name}`} className="p-1.5 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors disabled:opacity-50 disabled:cursor-wait">
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <Avatar member={m} size={72} style={{ boxShadow: '0 0 0 2px #fff' }} />
      <div>
        <div className="text-base font-semibold text-charcoal">{m.name}</div>
        {m.whatsapp_linked && (
          <div className="text-xs text-warm-grey mt-0.5">WhatsApp</div>
        )}
      </div>
      <span
        className={`text-[11px] font-semibold tracking-[0.04em] px-2.5 py-1 rounded-full ${rm.cls}`}
        style={rm.style}
      >
        {rm.label}
      </span>
    </div>
  );
}

// Dashed "add" tile that mirrors the member-card footprint.
function AddTile({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-[18px] border-[1.5px] border-dashed border-light-grey bg-transparent flex flex-col items-center justify-center gap-3 min-h-[184px] text-warm-grey hover:border-plum/40 hover:text-plum transition-colors"
    >
      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: SOFT }}>
        <IconPlus className="h-6 w-6" />
      </div>
      <div className="text-sm font-semibold">{label}</div>
    </button>
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Term-aware weekly activities helpers ──
const todayYmd = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
const isOngoingActivity = (a) => !a.start_date && !a.end_date;
// Does an activity's window overlap a term's window? (ongoing always does)
function activityInTerm(a, term) {
  if (isOngoingActivity(a)) return true;
  if (a.end_date && a.end_date < term.start_date) return false;
  if (a.start_date && a.start_date > term.end_date) return false;
  return true;
}
const fmtTermRange = (t) => {
  const f = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${f(t.start_date)} – ${f(t.end_date)}`;
};
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

// Soft per-member card tint (the member's colour at low opacity), used to
// give each Family Member / dependent row its own gently-coloured card.
// Literal class strings so Tailwind generates them.
const CARD_TINTS = {
  red: 'bg-red/10',
  'burnt-orange': 'bg-burnt-orange/10',
  amber: 'bg-amber/10',
  gold: 'bg-gold/10',
  leaf: 'bg-leaf/10',
  emerald: 'bg-emerald/10',
  teal: 'bg-teal/10',
  sky: 'bg-sky/10',
  cobalt: 'bg-cobalt/10',
  indigo: 'bg-indigo/10',
  purple: 'bg-purple/10',
  magenta: 'bg-magenta/10',
  rose: 'bg-rose/10',
  terracotta: 'bg-terracotta/10',
  moss: 'bg-moss/10',
  slate: 'bg-slate/10',
  // Legacy fallbacks
  sage: 'bg-sage/10',
  plum: 'bg-plum/10',
  coral: 'bg-coral/10',
  lavender: 'bg-indigo/10',
};

// Canonical 16-colour palette used for auto-assigning a unique colour
// to each new household member. Order matches the backend's
// COLOR_THEMES (src/db/queries.js) so the picker on both sides agrees
// on which colour is "next" — keeps invitee-side auto-pick in sync
// with admin-side auto-pick.
const COLOR_THEMES = [
  'red', 'burnt-orange', 'amber', 'gold',
  'leaf', 'emerald', 'teal', 'sky',
  'cobalt', 'indigo', 'purple', 'magenta',
  'rose', 'terracotta', 'moss', 'slate',
];

/**
 * Pick the first colour in the 16-palette not already used by anyone
 * in the household. Same algorithm as the server-side
 * db.pickColorForNewMember — kept in the frontend too so when the
 * admin opens the Add-member / Add-dependent form, the colour swatch
 * is already pointing at a sensible default instead of always defaulting
 * to teal (which collided with the first member's teal default and
 * left every household looking like a wall of teal avatars).
 */
function pickNextAvatarColor(existingMembers) {
  const used = new Set((existingMembers || []).map(m => m?.color_theme).filter(Boolean));
  for (const c of COLOR_THEMES) {
    if (!used.has(c)) return c;
  }
  // All 16 in use — round-robin past the limit. Rare.
  return COLOR_THEMES[(existingMembers?.length || 0) % COLOR_THEMES.length];
}

export default function FamilySetup() {
  // Family Setup is all collaborative management, so gate on canManage (any
  // adult member), not the legacy single-admin flag.
  const { household, user, canManage: isAdmin, login, token } = useAuth();
  const canWrite = useCanWrite();
  // Country-specific school flow gates. There are now three flows:
  //   • UK: GIAS-driven school search + LA term-date scrape (full-fat)
  //   • SA: free-text school name + national term-date import (1.3.0+)
  //   • Other: schools feature hidden entirely with a Coming-soon card
  const isUk = isUkHousehold(household);
  const isSa = isSouthAfricaHousehold(household);
  const showSchools = hasSchoolsFeature(household);

  // (Household name + address are now edited via the modal - see
  // hhEdit* state below. The old inline-textfield setup is gone.)
  // Household default reminder time. Previously editable on this page but
  // removed from the UI now that each member sets their own time - the
  // column is kept as the scheduler's fallback for users who haven't set a
  // personal time. The seed value (set on signup) remains in the DB and is
  // never re-edited from the client. Read here only to display in the
  // per-member hint copy.
  const householdReminderTime = household?.reminder_time?.slice(0, 5) ?? '08:00';
  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');
  const [householdAllergies, setHouseholdAllergies] = useState(() => {
    try { return JSON.parse(household?.allergies || '[]'); } catch { return []; }
  });
  const [savingAllergies, setSavingAllergies] = useState(false);

  // ── Household edit modal ────────────────────────────────────────────
  // Opens from the Household card's pencil icon (or by clicking the
  // avatar / "Add address" link). Local form state is kept separate
  // from the live `household` from auth context so a Cancel discards
  // changes without polluting state. On Save we PATCH /settings, upload
  // a new avatar if the user picked one, then refresh the auth context.
  const [showHouseholdEdit, setShowHouseholdEdit] = useState(false);
  const [hhEditName, setHhEditName] = useState('');
  const [hhEditAddress, setHhEditAddress] = useState('');
  const [hhEditAvatarPreview, setHhEditAvatarPreview] = useState(null); // data URL or existing URL
  const [hhEditAvatarFile, setHhEditAvatarFile] = useState(null); // File when user picked a new image
  const [hhEditAvatarRemove, setHhEditAvatarRemove] = useState(false); // true if user clicked "Remove photo"
  const [joinCodeCopied, setJoinCodeCopied] = useState(false);
  const [hhAddressSuggestions, setHhAddressSuggestions] = useState([]);
  const [hhAddressSearching, setHhAddressSearching] = useState(false);
  const [hhEditSaving, setHhEditSaving] = useState(false);

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
  // UK custom-school fallback for the invite modal — mirrors the
  // dep* equivalents on the add-dependent flow.
  const [newCustomSchoolMode, setNewCustomSchoolMode] = useState(false);
  const [newCustomSchoolName, setNewCustomSchoolName] = useState('');
  const [newCustomSchoolPostcode, setNewCustomSchoolPostcode] = useState('');
  // SA path for the invite-member modal: free-text school name plus an
  // optional pointer to an already-linked household school (when the
  // user clicks a chip to reuse a sibling's school). When existingId is
  // set, the handler links to that row without creating a new one.
  const [newSaSchoolName, setNewSaSchoolName] = useState('');
  const [newSaSchoolExistingId, setNewSaSchoolExistingId] = useState(null);

  // Add dependent state
  const [showAddDependent, setShowAddDependent] = useState(false);
  // Set of member-ids currently being deleted. Used to show a busy
  // affordance in the row while the (potentially slow) cascade RPC
  // runs, and to suppress duplicate clicks. The row itself is hidden
  // optimistically before the request fires.
  const [removingMemberIds, setRemovingMemberIds] = useState(() => new Set());
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
  // SA path for the add-dependent modal - see the equivalent newSa* vars
  // above for the same pattern.
  const [depSaSchoolName, setDepSaSchoolName] = useState('');
  const [depSaSchoolExistingId, setDepSaSchoolExistingId] = useState(null);
  // UK custom-school fallback — when GIAS doesn't have the school
  // (private, alternative provision, very new, etc.), the user enters
  // it manually. school_name is required; postcode optional. school_urn
  // stays null so the LA-dates import doesn't try to resolve.
  const [depCustomSchoolMode, setDepCustomSchoolMode] = useState(false);
  const [depCustomSchoolName, setDepCustomSchoolName] = useState('');
  const [depCustomSchoolPostcode, setDepCustomSchoolPostcode] = useState('');
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
  // Separate flag for the household-card avatar quick-upload (different
  // from the per-member uploadingAvatar above). Lets us overlay a
  // loading state on the household photo without colliding with a
  // simultaneous member-profile upload.
  const [uploadingHouseholdAvatar, setUploadingHouseholdAvatar] = useState(false);
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
  // UK custom-school fallback for the edit-profile modal — mirrors the
  // dep/new flows so a school missing from GIAS can be added by name here too.
  const [editCustomSchoolMode, setEditCustomSchoolMode] = useState(false);
  const [editCustomSchoolName, setEditCustomSchoolName] = useState('');
  const [editCustomSchoolPostcode, setEditCustomSchoolPostcode] = useState('');
  // SA path for the edit-profile modal. profileSaSchoolName tracks the
  // (possibly newly-typed) name; profileSaSchoolExistingId, if set,
  // means "reuse this household_schools row" - typically populated when
  // the user clicks a chip to pick a sibling's school. The existing
  // profileSchoolId already covers "this member is currently linked to
  // school X" for both UK and SA - these two new vars handle the typing
  // step before that link is persisted.
  const [profileSaSchoolName, setProfileSaSchoolName] = useState('');
  const [profileSaSchoolExistingId, setProfileSaSchoolExistingId] = useState(null);
  const [addActivityDay, setAddActivityDay] = useState(0);
  const [addActivityName, setAddActivityName] = useState('');
  const [addActivityStart, setAddActivityStart] = useState('');
  const [addActivityEnd, setAddActivityEnd] = useState('');
  const [addActivityPickup, setAddActivityPickup] = useState(''); // member id or ''
  // Term-aware activities: the child's school terms, which term the grid is
  // showing (a term label | 'ongoing' | 'custom'), and custom-window inputs.
  const [activityTerms, setActivityTerms] = useState([]);
  const [selectedTermKey, setSelectedTermKey] = useState('ongoing');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [editingActivity, setEditingActivity] = useState(null); // activity being edited, or null = add mode
  // Standalone activity editor (driven by the Activities card). activityChild
  // is the child whose activity is being added/edited - decoupled from the
  // Edit-Profile modal's editingMember so activities can be managed in one
  // place for the whole household.
  const [activityChild, setActivityChild] = useState(null);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [activityTermsLoading, setActivityTermsLoading] = useState(false);
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
  const [importingPdf, setImportingPdf] = useState(false);
  // Draft import: holds the AI-extracted rows + source-text snippet
  // between the /preview call and the admin's "Save" tap. null while
  // not previewing. Each row carries a `warnings: string[]` from the
  // backend validator (src/services/termDateValidator.js). The admin
  // can edit any row in-place before confirming.
  const [draftImport, setDraftImport] = useState(null);
  const [savingDraftImport, setSavingDraftImport] = useState(false);
  const [showSourceQuoteFor, setShowSourceQuoteFor] = useState(null); // row index whose quote tooltip is open
  const [termImportIcalUrl, setTermImportIcalUrl] = useState('');
  const [importingTermIcal, setImportingTermIcal] = useState(false);
  const [importError, setImportError] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  // Add-a-school modal (household-level Schools section — create a school
  // without first adding a child).
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
  // A child's school link is now ONLY a term-calendar disambiguator,
  // surfaced as a dropdown when the household has 2+ schools. A child
  // carries no school otherwise (term context resolves from the
  // household's single school on the backend). These hold the dropdown
  // selection for the add-dependent / add-member modals; edit-profile
  // reuses the existing profileSchoolId.
  const [depSchoolId, setDepSchoolId] = useState(null);
  const [newSchoolId, setNewSchoolId] = useState(null);
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

  useEffect(() => { loadMembers(); loadSchools(); loadActivities(); }, []);

  function loadSchools() {
    loadCached(
      'schools',
      () => api.get('/schools').then(r => Array.isArray(r.data?.schools) ? r.data.schools : []),
      (sch) => setHouseholdSchools(sch),
    ).catch(() => {});
  }

  // Household-wide activities, grouped by child_id. Sourced from the dedicated
  // /schools/activities endpoint (not GET /schools) so a child with no school
  // link - the common case after the schools decoupling - still has their
  // after-school clubs surfaced in the Activities card + the dependents pills.
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

  async function handleCopyJoinCode() {
    if (!household?.join_code) return;
    try {
      await navigator.clipboard.writeText(household.join_code);
      setJoinCodeCopied(true);
      setTimeout(() => setJoinCodeCopied(false), 1800);
    } catch {
      // Clipboard API can fail in non-secure contexts / older
      // browsers. Silent fallback: the code is already on-screen so
      // the user can read + retype it manually.
    }
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
    // Pre-pick the next colour not yet used in this household so a
    // newly-added child gets a distinct avatar by default. Admin can
    // still override before saving.
    setDepColor(pickNextAvatarColor(members));
    setDepAttendsSchool(false);
    setDepSchoolSearch('');
    setDepSelectedSchool(null);
    setDepSchoolResults([]);
    setDepCustomSchoolMode(false);
    setDepCustomSchoolName('');
    setDepCustomSchoolPostcode('');
    setDepSchoolId(null);
    setShowAddDependent(true);
  }

  async function handleAddDependent() {
    if (!depName.trim()) { setError('Name is required.'); return; }
    setAddingDependent(true);
    setError('');
    try {
      // School is only a term-calendar disambiguator now, picked from the
      // existing household schools via the dropdown that appears when the
      // household has 2+ schools. Schools are created/managed in the
      // Schools card, never inline here. With 0/1 schools the child
      // carries no school_id (term context resolves from the household's
      // single school on the backend).
      const schoolId = (showSchools && householdSchools.length >= 2) ? (depSchoolId || null) : null;

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
      setSuccess('Member added!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add member.');
    } finally {
      setAddingDependent(false);
    }
  }

  // Remove a household_schools row (typed school) from the SA chip
  // picker. Warns if any family members are linked to it - the backend
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
    // Optimistic delete: hide the row immediately so the user sees
    // something happen. The backend cascade (delete_user_cascade RPC)
    // can take 5-15s on households with months of activity — the old
    // code awaited silently and the row stayed on screen the whole
    // time, which read as "nothing happened, did I really click it?"
    // On failure, re-insert the row at its original position and show
    // the error.
    setRemovingMemberIds((prev) => new Set(prev).add(member.id));
    const prevMembers = members;
    setMembers((cur) => cur.filter((m) => m.id !== member.id));
    try {
      await api.delete(`/household/dependents/${member.id}`);
    } catch (err) {
      // Rollback the optimistic removal.
      setMembers(prevMembers);
      setError(err.response?.data?.error || 'Could not remove member.');
    } finally {
      setRemovingMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(member.id);
        return next;
      });
    }
  }

  // Personal profiles are private: an adult can edit only their OWN profile.
  // Children (dependents) have no login, so any adult may edit theirs.
  function canEditProfile(m) {
    return !!m && (m.id === user?.id || m.member_type === 'dependent');
  }

  function openEditProfile(member) {
    if (!canEditProfile(member)) return;
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
    setEditCustomSchoolMode(false);
    setEditCustomSchoolName('');
    setEditCustomSchoolPostcode('');
    // SA path: pre-fill the typed name + the existing-school pointer.
    // The UK GIAS-search inputs above are simply unused on SA households.
    setProfileSaSchoolName(school?.school_name || '');
    setProfileSaSchoolExistingId(school?.id || null);
    setShowAddTermDate(false);
    setEditTermDates([]);
    // Activities + term dates are no longer managed inside the profile modal -
    // they live in the household-level Schools and Activities cards now. So
    // there's nothing school-related to pre-load here.
  }

  // Open the form to ADD a new activity (clears any edit state).
  // Load a child's school terms so the activity modal's term selector can
  // default to the current term and offer real terms (with auto-filled date
  // windows). Falls back to 'ongoing' when the child has no resolvable
  // school / terms.
  function loadActivityTerms(childId) {
    setActivityTermsLoading(true);
    api.get(`/schools/terms/${childId}`)
      .then(({ data }) => {
        const terms = data.terms || [];
        setActivityTerms(terms);
        const today = todayYmd();
        const cur = terms.find(t => today >= t.start_date && today <= t.end_date);
        setSelectedTermKey(cur ? cur.start_date : 'ongoing');
      })
      .catch(() => { setActivityTerms([]); setSelectedTermKey('ongoing'); })
      .finally(() => setActivityTermsLoading(false));
  }

  // Open the activity modal in ADD mode for a specific child.
  function openAddActivity(child) {
    const c = child || activityChild;
    if (!c) return;
    setActivityChild(c);
    setEditingActivity(null);
    setAddActivityDay(0);
    setAddActivityName('');
    setAddActivityStart('');
    setAddActivityEnd('');
    setAddActivityPickup('');
    setCustomStart('');
    setCustomEnd('');
    loadActivityTerms(c.id);
    setActivityModalOpen(true);
  }

  // Open the activity modal in EDIT mode (pre-filled) for a child's activity.
  function openEditActivity(child, a) {
    const c = child || activityChild;
    if (!c) return;
    setActivityChild(c);
    setEditingActivity(a);
    setAddActivityDay(a.day_of_week ?? 0);
    setAddActivityName(a.activity || '');
    setAddActivityStart(a.time_start ? a.time_start.substring(0, 5) : '');
    setAddActivityEnd(a.time_end ? a.time_end.substring(0, 5) : '');
    setAddActivityPickup(a.pickup_member_id || '');
    loadActivityTerms(c.id);
    setActivityModalOpen(true);
  }

  function closeActivityForm() {
    setActivityModalOpen(false);
    setEditingActivity(null);
  }

  // Handles both add (POST) and edit (PATCH) depending on editingActivity.
  async function handleAddActivity() {
    if (!addActivityName.trim() || !activityChild) return;
    setSavingActivity(true);
    try {
      const body = {
        day_of_week: addActivityDay,
        activity: addActivityName.trim(),
        time_start: addActivityStart || null,
        time_end: addActivityEnd || null,
        pickup_member_id: addActivityPickup || null,
      };
      // New activities inherit the selected term's window so they only show
      // that term (and next term can be prepared without touching this one).
      // Edits preserve the activity's existing window (the grid selector is a
      // view control, not a per-activity move).
      if (!editingActivity) {
        const termObj = activityTerms.find(t => t.start_date === selectedTermKey) || null;
        if (selectedTermKey === 'custom') {
          Object.assign(body, { start_date: customStart || null, end_date: customEnd || null, term_label: null });
        } else if (termObj) {
          Object.assign(body, { start_date: termObj.start_date, end_date: termObj.end_date, term_label: termObj.label });
        } else {
          Object.assign(body, { start_date: null, end_date: null, term_label: null });
        }
      }
      if (editingActivity) {
        await api.patch(`/schools/activities/${editingActivity.id}`, body);
      } else {
        await api.post('/schools/activities', { ...body, child_id: activityChild.id });
      }
      closeActivityForm();
      await loadActivities(); // refresh childActivities (the card + pills read from it)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save activity.');
    } finally {
      setSavingActivity(false);
    }
  }

  async function handleAddTermDate() {
    if (!termDateDate || !editingMember?.school_id) return;
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
      const academicYear = (household?.country === 'ZA')
        ? getAcademicYearSa(termDateDate)
        : getAcademicYearUk(termDateDate);
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
  // so there's no per-school lookup negotiation - one tap copies the
  // canonical national dates onto this household_schools row.
  async function handleImportSaTermDates() {
    if (!termDateSchoolId) return;
    setImportingLA(true); // reuse the LA-import busy flag - only one
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
    // Step 1 of 2: fetch a preview from the backend (no DB writes yet).
    // The admin then reviews, edits, and confirms in a separate panel -
    // see handleConfirmImportWebsite below.
    if (!termDateSchoolId || !websiteUrl.trim()) return;
    // Normalise the URL: users often paste "school.com/term-dates" with
    // no scheme. Auto-prepend https:// so the server-side fetch doesn't
    // explode with an unhelpful error. Reject only obviously-malformed
    // input (whitespace mid-string, no dot in the host).
    let normalisedUrl = websiteUrl.trim();
    if (!/^https?:\/\//i.test(normalisedUrl)) normalisedUrl = `https://${normalisedUrl}`;
    try {
      const u = new URL(normalisedUrl);
      if (!u.hostname.includes('.')) throw new Error('bad host');
    } catch {
      setImportError("That doesn't look like a valid website address. Make sure it starts with https://");
      return;
    }
    setImportingWebsite(true);
    setImportError('');
    try {
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-website/preview`, { website_url: normalisedUrl });
      if (!Array.isArray(data.dates) || data.dates.length === 0) {
        setImportError(data.message || 'No term dates found on that page. Try a different URL or another import method.');
        return;
      }
      setDraftImport({
        schoolId: termDateSchoolId,
        schoolName: termDateSchoolName,
        sourceUrl: data.source_url || normalisedUrl,
        sourceTextPreview: data.source_text_preview || '',
        dates: data.dates.map((d, i) => ({ ...d, _id: `draft-${i}` })),
      });
      setShowTermDateOptions(false);
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not import from website. Try another option below.');
    } finally {
      setImportingWebsite(false);
    }
  }

  /**
   * Alternative to the URL flow: the user uploads the school's
   * term-dates PDF directly. Useful when the school hosts the PDF
   * behind SharePoint / Google Drive auth, or when the term-dates
   * page is JavaScript-rendered and our HTML scrape returns gibberish.
   *
   * Same preview-and-confirm pattern as the URL flow — the response
   * shape is identical, so the same review panel + confirm endpoint
   * handle it from here.
   */
  async function handleImportPdf(file) {
    if (!termDateSchoolId || !file) return;
    setImportingPdf(true);
    setImportError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post(`/schools/${termDateSchoolId}/import-pdf/preview`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!Array.isArray(data.dates) || data.dates.length === 0) {
        setImportError(data.message || 'No term dates found in that PDF. Try a different file.');
        return;
      }
      setDraftImport({
        schoolId: termDateSchoolId,
        schoolName: termDateSchoolName,
        sourceUrl: data.source_url || file.name,
        sourceTextPreview: data.source_text_preview || '',
        dates: data.dates.map((d, i) => ({ ...d, _id: `draft-${i}` })),
      });
      setShowTermDateOptions(false);
    } catch (err) {
      setImportError(err.response?.data?.error || 'Could not read that PDF. Try a different file or another import method.');
    } finally {
      setImportingPdf(false);
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
      const { data } = await api.post(`/schools/${draftImport.schoolId}/import-website/confirm`, { dates: payload });
      setSuccess(data.message || 'Term dates imported!');
      setTimeout(() => setSuccess(''), 3000);
      const sid = draftImport.schoolId;
      setDraftImport(null);
      await loadSchools();
      if (editingMember?.school_id === sid) {
        const { data: tdData } = await api.get(`/schools/${sid}/term-dates`);
        setEditTermDates(tdData.term_dates || []);
      }
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
  // The earlier static "Sept-20 cutoff" lost both the Sep-22 term_end
  // (bucketed into Term 4) and the Term 3 boundary view (no term_end
  // in its bucket → fallback to listing every date).
  //
  // Fallback to month-based bucketing only when there are no term_start
  // events in a year - defensive, rarely hits.
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
        // logic - imperfect but better than nothing.
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

  function openUpdateTermDates(schoolArg) {
    const school = schoolArg || householdSchools.find(s => s.id === editingMember?.school_id);
    if (!school) return;
    setTermDateSchoolId(school.id);
    setTermDateSchoolName(school.school_name);
    setTermDateSchoolLA(school.local_authority || '');
    setImportError('');
    setWebsiteUrl('');
    setTermImportIcalUrl('');
    setShowTermDateOptions(true);
  }

  // Open the read/edit "all term dates" modal for a specific school (used by
  // the household-level Schools card). Loads that school's dates into the
  // shared editTermDates state and keys the modal by termDateSchoolId.
  function openViewDates(school) {
    if (!school) return;
    setTermDateSchoolId(school.id);
    setTermDateSchoolName(school.school_name);
    setEditTermDates(school.term_dates || []);
    setShowAllDates(true);
  }

  // --- Add-a-school flow (household-level Schools card) -----------------
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
      if (isSa) {
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

  async function handleSyncIcal(schoolArg) {
    const school = schoolArg || householdSchools.find(s => s.id === editingMember?.school_id);
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
      await loadActivities();
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

      // School link is only a term-calendar disambiguator now, surfaced as
      // a per-child dropdown that appears when the household has 2+ schools.
      // With 0/1 schools the picker is hidden, so we preserve the member's
      // existing link (legacy values stay valid; term context resolves from
      // the household's single school on the backend). Schools are
      // created/managed in the Schools card, never inline here.
      if (showSchools && householdSchools.length >= 2) {
        payload.school_id = profileSchoolId || null;
      } else {
        payload.school_id = editingMember?.school_id ?? null;
      }

      // Check if school changed (new school linked that may need term dates)
      const schoolChanged = payload.school_id && payload.school_id !== editingMember?.school_id;

      // When admin edits another member, include target user_id
      if (!isEditingSelf) {
        payload.user_id = targetId;
      }

      await api.patch('/household/profile', payload);
      await loadMembers();

      // Orphan cleanup is owned by the backend now (PATCH /household/profile
      // safely deletes the old school only when it has no children AND no
      // term dates AND no iCal feed, and invalidates the schools cache), so
      // we just re-fetch the definitive, freshly-invalidated list here.
      const freshSchools = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(freshSchools);

      // Only update auth context if editing own profile
      if (isEditingSelf) {
        const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor };
        login({ token, user: updatedUser, household });
      }
      setEditingMember(null);

      // If school changed, show term date import options - but ONLY if the school has no term dates yet
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
    // Same optimistic pattern as handleRemoveDependent above — the
    // backend cascade-delete is slow on real households and silent
    // awaits read as broken UI.
    setRemovingMemberIds((prev) => new Set(prev).add(member.id));
    const prevMembers = members;
    setMembers((cur) => cur.filter((m) => m.id !== member.id));
    try {
      await api.delete(`/household/members/${member.id}`);
    } catch (err) {
      setMembers(prevMembers);
      setError(err.response?.data?.error || 'Could not remove member.');
    } finally {
      setRemovingMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(member.id);
        return next;
      });
    }
  }

  // ── Household-edit modal: open / save / cancel ─────────────────────

  function openHouseholdEdit() {
    setHhEditName(household?.name || '');
    setHhEditAddress(household?.address || '');
    setHhEditAvatarPreview(household?.avatar_url || null);
    setHhEditAvatarFile(null);
    setHhEditAvatarRemove(false);
    setHhAddressSuggestions([]);
    setShowHouseholdEdit(true);
  }

  function closeHouseholdEdit() {
    setShowHouseholdEdit(false);
    setHhAddressSuggestions([]);
  }

  // File picker → preview the picked image immediately (data URL) so
  // the user sees their choice before saving. The actual upload happens
  // on Save.
  function onAvatarFilePicked(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image is too large - please use one under 5 MB.');
      return;
    }
    setHhEditAvatarFile(file);
    setHhEditAvatarRemove(false);
    const reader = new FileReader();
    reader.onload = () => setHhEditAvatarPreview(reader.result);
    reader.readAsDataURL(file);
  }

  // Direct-from-card avatar upload. Clicking the household photo on
  // the FamilySetup page triggers a file picker (via the wrapping
  // <label>), and the file is uploaded immediately. The bigger
  // edit-everything modal stays available behind the Edit button for
  // changing the household name + address.
  async function handleDirectHouseholdAvatarUpload(file) {
    if (!file) return;
    // Blobs from the iOS Camera plugin have .type set ('image/jpeg' or
    // similar) but no .name; web File objects have both. Either way
    // type-check works.
    if (file.type && !file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image is too large - please use one under 5 MB.');
      return;
    }
    setUploadingHouseholdAvatar(true);
    setError('');
    try {
      const form = new FormData();
      // Synthesize a filename for blobs that don't carry one.
      form.append('avatar', file, file.name || 'household.jpg');
      const { data } = await api.post('/household/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data?.household) {
        login({ token, user, household: data.household });
      }
      setSuccess('Household photo updated.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload photo.');
    } finally {
      setUploadingHouseholdAvatar(false);
    }
  }

  function removeAvatarInEdit() {
    setHhEditAvatarFile(null);
    setHhEditAvatarRemove(true);
    setHhEditAvatarPreview(null);
  }

  async function handleSaveHousehold() {
    setError(''); setSuccess('');
    if (!hhEditName.trim()) { setError('Household name cannot be empty.'); return; }
    setHhEditSaving(true);
    try {
      // 1. Patch name + address.
      const { data } = await api.patch('/settings/settings', {
        name: hhEditName.trim(),
        address: hhEditAddress.trim() || null,
      });
      let updatedHousehold = data.household;

      // 2. If the user picked a new image, upload it.
      if (hhEditAvatarFile) {
        const form = new FormData();
        form.append('avatar', hhEditAvatarFile);
        const upRes = await api.post('/household/avatar', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (upRes.data?.household) updatedHousehold = upRes.data.household;
      } else if (hhEditAvatarRemove && household?.avatar_url) {
        // 3. Or, if the user clicked "Remove photo", clear the avatar.
        const delRes = await api.delete('/household/avatar');
        if (delRes.data?.household) updatedHousehold = delRes.data.household;
      }

      login({ token, user, household: updatedHousehold });
      setSuccess('Household updated.');
      setTimeout(() => setSuccess(''), 2500);
      closeHouseholdEdit();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save household.');
    } finally {
      setHhEditSaving(false);
    }
  }

  // Debounced address search - fires 300 ms after the user stops typing
  // to keep upstream calls (and our proxy's cache hits) lean. Skips
  // queries shorter than 3 chars (matches the backend's early-return).
  useEffect(() => {
    if (!showHouseholdEdit) return;
    const q = hhEditAddress.trim();
    if (q.length < 3) { setHhAddressSuggestions([]); return; }
    // If the current input exactly matches a suggestion the user just
    // picked, don't re-search - keeps the dropdown closed after a pick.
    if (hhAddressSuggestions.some((s) => s.label === q)) return;
    let cancelled = false;
    setHhAddressSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/household/address-search', { params: { q } });
        if (!cancelled) setHhAddressSuggestions(data.suggestions || []);
      } catch {
        if (!cancelled) setHhAddressSuggestions([]);
      } finally {
        if (!cancelled) setHhAddressSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hhEditAddress, showHouseholdEdit]); // eslint-disable-line react-hooks/exhaustive-deps -- hhAddressSuggestions intentionally omitted to avoid re-searching after picking

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
    // Pre-pick the next unused colour from the 16-palette so the
    // invitee defaults to a distinct avatar instead of always landing
    // on teal. Same logic the backend uses when an invite has no
    // explicit colour — keeps the swatch the admin sees in sync with
    // the colour the invitee ends up with.
    setNewColor(pickNextAvatarColor(members));
    setNewEmail('');
    setNewCustomSchoolMode(false);
    setNewCustomSchoolName('');
    setNewCustomSchoolPostcode('');
    setNewSchoolId(null);
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
      // School is only a term-calendar disambiguator now, picked from the
      // existing household schools via the dropdown shown when there are
      // 2+ schools. No inline school creation - that lives in the Schools
      // card.
      const schoolId = (showSchools && householdSchools.length >= 2) ? (newSchoolId || null) : null;

      await api.post('/household/invite', {
        email: newEmail.trim(),
        name: newName.trim(),
        family_role: newRole.trim() || null,
        birthday: newBirthday || null,
        color_theme: newColor,
        school_id: schoolId,
      });
      setShowAddMember(false);
      setNewSchoolId(null);
      setSuccess(`Invite sent to ${newEmail.trim()}`);
      setTimeout(() => setSuccess(''), 3000);
      const { data } = await api.get('/household/invites');
      setPendingInvites(data.invites ?? []);
      // Refresh household schools - a new one may have just been created.
      const refreshedSchools = await api.get('/schools').then(r => r.data.schools || []);
      setHouseholdSchools(refreshedSchools);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send invite.');
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <div className="max-w-[1080px] mx-auto space-y-6 pb-24">
      <PageHeader
        kicker={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        title={familyTitle(household?.name)}
        subtitle="Manage who's in your household and how Housemait works for everyone."
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!canWrite && <SubscribePrompt message="Subscribe to invite family members and edit profiles" />}

      {/* Household card (design handoff: photo + members + address | invite
          zone). One responsive component - two zones side-by-side on desktop,
          stacked below the `sm` breakpoint. The household NAME is deliberately
          not repeated here; it lives in the PageHeader <h1> above. */}
      {success && (
        <p className="text-sm text-sage bg-sage-light rounded-xl px-3 py-2">{success}</p>
      )}
      <div
        className="flex flex-col sm:flex-row sm:items-stretch overflow-hidden bg-white"
        style={{ borderRadius: 22, border: '1px solid var(--color-light-grey)', boxShadow: '0 1px 0 rgba(26,22,32,0.03), 0 6px 20px rgba(26,22,32,0.05)' }}
      >
        {/* Identity zone */}
        <div className="flex-1 min-w-0 flex items-center gap-5 sm:gap-6 px-5 py-5 sm:px-[30px] sm:py-[26px]">
          <button
            type="button"
            disabled={!isAdmin || uploadingHouseholdAvatar}
            onClick={async () => {
              if (!isAdmin || uploadingHouseholdAvatar) return;
              const blob = await pickPhoto();
              if (blob) await handleDirectHouseholdAvatarUpload(blob);
            }}
            className={`shrink-0 relative group rounded-[20px] overflow-hidden ${isAdmin && !uploadingHouseholdAvatar ? 'cursor-pointer' : 'cursor-default'}`}
            aria-label={isAdmin ? 'Upload a family photo' : 'Family photo'}
            title={isAdmin ? 'Upload a family photo' : ''}
          >
            {household?.avatar_url ? (
              <img
                src={household.avatar_url}
                alt=""
                className={`w-[76px] h-[76px] sm:w-[104px] sm:h-[104px] object-cover transition-opacity ${uploadingHouseholdAvatar ? 'opacity-60' : ''}`}
              />
            ) : (
              <div
                className="w-[76px] h-[76px] sm:w-[104px] sm:h-[104px] flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #EFE9FB 0%, #F3EEE5 52%, #FBE6EA 100%)' }}
              >
                <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white flex items-center justify-center" style={{ boxShadow: '0 2px 8px rgba(26,22,32,0.12)' }}>
                  <IconCameraSimple className="h-5 w-5 text-plum" />
                </span>
              </div>
            )}
            {isAdmin && (
              <span className={`absolute inset-0 transition-colors flex items-center justify-center ${uploadingHouseholdAvatar ? 'bg-black/30 opacity-100' : 'bg-black/0 group-hover:bg-black/30 opacity-0 group-hover:opacity-100'}`}>
                {uploadingHouseholdAvatar
                  ? <span className="text-white text-xs font-medium">Uploading…</span>
                  : <IconCameraSimple className="h-5 w-5 text-white" />}
              </span>
            )}
          </button>

          <div className="min-w-0">
            {/* Members: avatar stack + count */}
            <div className="flex items-center gap-3">
              <div className="flex" role="img" aria-label={`${members.length} member${members.length === 1 ? '' : 's'}: ${members.map(m => m.name).join(', ')}`}>
                {members.slice(0, 5).map((m, i) => (
                  m.avatar_url ? (
                    <img
                      key={m.id}
                      src={m.avatar_url}
                      alt=""
                      aria-hidden="true"
                      className="rounded-full object-cover"
                      style={{ width: 32, height: 32, border: '2.5px solid #fff', marginLeft: i ? -10 : 0 }}
                    />
                  ) : (
                    <span
                      key={m.id}
                      aria-hidden="true"
                      className="rounded-full flex items-center justify-center text-white"
                      style={{ width: 32, height: 32, fontSize: 13, fontWeight: 600, background: hexFor(m), border: '2.5px solid #fff', marginLeft: i ? -10 : 0 }}
                    >
                      {m.name?.[0]?.toUpperCase()}
                    </span>
                  )
                ))}
              </div>
              <span className="text-[15px] font-semibold text-charcoal">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </span>
            </div>

            {/* Address: filled (pin + text + edit) or empty (dashed prompt) */}
            {household?.address ? (
              <div className="flex items-start gap-2 mt-4">
                <IconMapPin className="h-4 w-4 shrink-0 mt-0.5 text-[var(--ink-2)]" />
                <span className="flex-1 text-sm text-warm-grey leading-snug">{household.address}</span>
                {isAdmin && (
                  <button type="button" onClick={openHouseholdEdit} aria-label="Edit home address" className="shrink-0 p-1 -m-1 text-[var(--ink-2)] hover:text-plum transition-colors">
                    <IconEdit className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : isAdmin ? (
              <button
                type="button"
                onClick={openHouseholdEdit}
                className="inline-flex items-center gap-2 mt-4 px-3.5 py-2 rounded-[10px] text-[13.5px] font-semibold text-plum transition-colors hover:bg-plum-light"
                style={{ border: '1.5px dashed var(--color-light-grey)' }}
              >
                <IconMapPin className="h-4 w-4" /> Add your home address
              </button>
            ) : (
              <p className="text-xs text-warm-grey mt-4">No address set.</p>
            )}
          </div>
        </div>

        {/* Invite zone */}
        {household?.join_code && (
          <div
            className="flex flex-col justify-center gap-3.5 px-5 py-[18px] sm:px-7 sm:py-[26px] sm:w-[296px] sm:shrink-0 border-t border-light-grey sm:border-t-0 sm:border-l"
            style={{ background: SOFT }}
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-2)] mb-2">Invite code</div>
              <div className="inline-flex items-center gap-3">
                <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace', fontWeight: 700, fontSize: 24, letterSpacing: '0.18em', color: 'var(--color-charcoal)' }}>
                  {household.join_code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyJoinCode}
                  aria-label="Copy invite code"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[9px] text-[12.5px] font-semibold bg-white text-warm-grey transition-colors hover:border-plum/40"
                  style={{ border: '1px solid var(--color-light-grey)' }}
                >
                  {joinCodeCopied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 6.5" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" /></svg>
                  )}
                  {joinCodeCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <span aria-live="polite" className="sr-only">{joinCodeCopied ? 'Invite code copied' : ''}</span>
            </div>
            <p className="text-xs text-[var(--ink-2)] leading-snug m-0">New members enter this code to join your household.</p>
          </div>
        )}
      </div>
      {!isAdmin && (
        <p className="text-xs text-warm-grey">Only admins can change household details.</p>
      )}

      {/* Members - one card per household member (accounts), role pill
          distinguishes Admin / Parent. Edit + remove on hover. */}
      <section>
        <h2 className="text-lg font-semibold text-charcoal mb-0.5">Members</h2>
        <p className="text-sm text-[var(--ink-2)] mb-4">Family members with their own accounts.</p>
        {loadingMembers ? <Spinner /> : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {members.filter(m => m.member_type !== 'dependent').map((m) => (
              <MemberCard
                key={m.id}
                m={m}
                canEdit={canEditProfile(m)}
                canRemove={isAdmin && m.id !== user?.id && m.role !== 'admin'}
                removing={removingMemberIds.has(m.id)}
                onEdit={() => openEditProfile(m)}
                onRemove={() => handleRemoveMember(m)}
              />
            ))}
            {isAdmin && <AddTile label="Invite a member" onClick={openAddMember} />}
          </div>
        )}

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-semibold text-warm-grey uppercase tracking-[0.1em] mb-2">Pending invites</p>
            <div className="bg-white rounded-2xl border border-light-grey divide-y divide-light-grey overflow-hidden">
              {pendingInvites.map((inv) => {
                // wa.me deep-link with a friendly preset, pinned to the public
                // housemait.com host (window.location.origin is capacitor://
                // inside the iOS app, which invitees can't open).
                const inviteUrl = `https://housemait.com/signup?invite=${inv.token}`;
                const inviteeName = (inv.name || '').trim();
                const greeting = inviteeName ? `Hi ${inviteeName.split(' ')[0]}` : 'Hey';
                const waText = `${greeting} - I've set up our family on Housemait so we can keep our calendar, shopping and tasks in one place. Tap to join: ${inviteUrl}`;
                const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
                return (
                  <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="text-charcoal truncate">{inv.name || inv.email}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-warm-grey hidden sm:inline">
                        {inv.name ? inv.email : ''} · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </span>
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-sage hover:text-sage/80 transition-colors"
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
                        className="text-xs font-medium text-coral hover:text-coral/80 transition-colors"
                        title="Cancel invite"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Children & dependents - members without their own login. Same card
          treatment; activities + school live in their own sections now. */}
      <section>
        <h2 className="text-lg font-semibold text-charcoal mb-0.5">Children &amp; dependents</h2>
        <p className="text-sm text-[var(--ink-2)] mb-4">Family members who don&apos;t need their own account (e.g. infants, young children, pets). They can be assigned tasks and events.</p>
        {loadingMembers ? <Spinner /> : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {members.filter(m => m.member_type === 'dependent').map((m) => (
              <MemberCard
                key={m.id}
                m={m}
                canEdit={canEditProfile(m)}
                canRemove={canEditProfile(m)}
                removing={removingMemberIds.has(m.id)}
                onEdit={() => openEditProfile(m)}
                onRemove={() => handleRemoveDependent(m)}
              />
            ))}
            {isAdmin && <AddTile label="Add a child or pet" onClick={openAddDependent} />}
            {members.filter(m => m.member_type === 'dependent').length === 0 && !isAdmin && (
              <p className="text-sm text-warm-grey">No other family members added yet.</p>
            )}
          </div>
        )}
      </section>

      {/* Schools - household-level section. Manage each school and its term
          dates here (decoupled from individual children, for privacy). For
          UK/SA households this is a real directory + term-date importer;
          everywhere else it's a coming-soon card. */}
      {showSchools ? (
        <section>
          <div className="flex items-end justify-between gap-3 mb-1">
            <h2 className="text-lg font-semibold text-charcoal">Schools</h2>
            {isAdmin && (
              <PillBtn icon={<IconPlus className="h-3.5 w-3.5" />} onClick={openAddSchool}>Add a school</PillBtn>
            )}
          </div>
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
                const sourceLabel = { local_authority: 'Local authority', school_website: 'School website', website_scrape: 'School website', ical: 'iCal feed', ical_import: 'iCal feed', sa_national: 'National calendar', 'sa-national': 'National calendar', whatsapp_import: 'WhatsApp', manual: 'Manual' }[school.term_dates_source] || school.term_dates_source;
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
                      <div className="w-[46px] h-[46px] rounded-[13px] shrink-0 flex items-center justify-center" style={{ background: colour + '1F', color: colour }}>
                        <IconGraduation className="h-6 w-6" />
                      </div>
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
                          <button onClick={() => handleClearAllTermDates(school.id)} className="text-xs font-medium text-warm-grey hover:text-coral">Clear all</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section>
          <h2 className="text-lg font-semibold text-charcoal mb-1">Schools</h2>
          <p className="text-sm text-[var(--ink-2)] max-w-[560px]">
            School directory and term-date imports are currently available
            in the UK and South Africa. Coming soon to more countries -
            until then, the rest of Housemait works the same.
          </p>
        </section>
      )}

      {/* Add-a-school modal (household-level - create a school without first
          adding a child). UK = GIAS directory search; SA = free-text name. */}
      {addSchoolOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setAddSchoolOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base md:text-medium font-semibold text-bark mb-1">Add a school</h2>
            <p className="text-xs text-cocoa mb-4">{isSa ? 'Enter the school name. You can import term dates next.' : 'Search the UK schools directory. You can import term dates next.'}</p>
            {isSa ? (
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
                disabled={addingSchool || (isSa ? !addSchoolSaName.trim() : (addSchoolManual ? !addSchoolManualName.trim() : !addSchoolSelected))}
                className="flex-1 bg-primary text-white font-semibold py-2.5 rounded-2xl hover:bg-primary-pressed transition-colors disabled:opacity-50 text-sm"
              >
                {addingSchool ? 'Adding…' : 'Add school'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activities - household-level. Everyone's after-school clubs in one
          place (data stays per-child; this is just one front door). UK/SA only,
          like the rest of the school features. Add/edit happens in the activity
          modal below. */}
      {showSchools && (() => {
        const activityKids = members.filter(m => m.member_type === 'dependent' || m.school_id);
        const sortByDayTime = (list) => list.slice().sort(
          (a, b) => (a.day_of_week - b.day_of_week) || ((a.time_start || '').localeCompare(b.time_start || '')),
        );
        // One row per club occurrence, sorted by weekday then time (matches the
        // design). day pill + kid-colour glyph tile + name + time + pickup.
        const renderRow = (kid, a, dim) => {
          const kidColor = hexFor(kid);
          const Glyph = ACTIVITY_ICONS[iconFor(a.activity)] || ACTIVITY_ICONS.star;
          const s = a.time_start ? a.time_start.substring(0, 5) : '';
          const e = a.time_end ? a.time_end.substring(0, 5) : '';
          const time = s && e ? `${s}–${e}` : s ? `from ${s}` : e ? `until ${e}` : '';
          const pickup = a.pickup_member_id ? members.find(m => m.id === a.pickup_member_id) : null;
          const dayLabel = DAY_LABELS[a.day_of_week];
          return (
            <button
              key={a.id}
              type="button"
              onClick={isAdmin ? () => openEditActivity(kid, a) : undefined}
              disabled={!isAdmin}
              aria-label={`${a.activity}, ${dayLabel}${time ? `, ${time}` : ''}${pickup ? `, pickup ${pickup.name}` : ''}`}
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
              {time && <span className="text-[12px] font-semibold text-warm-grey shrink-0 whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>}
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
            <h2 className="text-lg font-semibold text-charcoal mb-0.5">Activities</h2>
            <p className="text-sm text-[var(--ink-2)] mb-4">Everyone&apos;s after-school clubs in one place — times and who&apos;s on pickup.</p>
            {activityKids.length === 0 ? (
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
                      {other.length > 0 && (
                        <>
                          <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-warm-grey" style={{ borderTop: '1px solid var(--color-light-grey)' }}>Other terms</div>
                          {other.map(a => renderRow(kid, a, true))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* Activity add/edit modal - child-scoped via activityChild, opened from
          the Activities card. Reuses the shared activity form state. */}
      {activityModalOpen && activityChild && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => closeActivityForm()}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base md:text-medium font-semibold text-bark">{editingActivity ? 'Edit activity' : 'Add activity'}</h2>
              <button onClick={() => closeActivityForm()} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-cocoa mb-4">For {activityChild.name}</p>

            <div className="space-y-3">
              <div className="flex gap-2">
                <select value={addActivityDay} onChange={(e) => setAddActivityDay(Number(e.target.value))} className="border border-cream-border rounded-lg px-2 py-2 text-sm bg-white">
                  {DAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
                <input type="text" value={addActivityName} onChange={(e) => setAddActivityName(e.target.value)} placeholder="e.g. Swimming" className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent" autoFocus />
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <label className="text-xs text-cocoa">Starts at:</label>
                <input type="time" value={addActivityStart} onChange={(e) => setAddActivityStart(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                <label className="text-xs text-cocoa">Ends at:</label>
                <input type="time" value={addActivityEnd} onChange={(e) => setAddActivityEnd(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
              </div>

              {/* Term window applies only to NEW activities. Edits keep their
                  existing window (the term concept is per-activity, not a move). */}
              {!editingActivity && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-cocoa font-medium">Term:</label>
                    <select value={selectedTermKey} onChange={(e) => setSelectedTermKey(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white">
                      {activityTerms.map(t => <option key={t.start_date} value={t.start_date}>{t.label}</option>)}
                      <option value="ongoing">Ongoing (every term)</option>
                      <option value="custom">Custom dates…</option>
                    </select>
                    {activityTermsLoading && <span className="text-[11px] text-cocoa">Loading…</span>}
                  </div>
                  {selectedTermKey === 'custom' ? (
                    <div className="flex gap-2 items-center flex-wrap">
                      <label className="text-xs text-cocoa">Runs:</label>
                      <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                      <span className="text-xs text-cocoa">to</span>
                      <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white" />
                    </div>
                  ) : (
                    <p className="text-[11px] text-cocoa">
                      {selectedTermKey === 'ongoing'
                        ? 'Will show every term, until you remove it.'
                        : `Will be set for ${(activityTerms.find(t => t.start_date === selectedTermKey)?.label) || 'this term'} only.`}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 items-center">
                <label className="text-xs text-cocoa whitespace-nowrap">Pickup:</label>
                <select value={addActivityPickup} onChange={(e) => setAddActivityPickup(e.target.value)} className="flex-1 border border-cream-border rounded-lg px-2 py-1.5 text-sm bg-white">
                  <option value="">No pickup set</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-5">
              {editingActivity && (
                <button
                  onClick={() => { const id = editingActivity.id; closeActivityForm(); handleDeleteActivity(id); }}
                  className="text-xs font-medium text-coral hover:text-coral/80 mr-auto"
                >
                  Delete
                </button>
              )}
              <button onClick={() => closeActivityForm()} className="text-sm font-medium text-cocoa hover:text-bark px-4 py-2">Cancel</button>
              <button onClick={handleAddActivity} disabled={savingActivity || !addActivityName.trim()} className="text-sm font-semibold text-white bg-primary hover:bg-primary-pressed disabled:opacity-50 rounded-lg px-4 py-2">
                {savingActivity ? 'Saving…' : (editingActivity ? 'Save' : 'Add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allergies & Dietary Requirements - a single white card. The chips are
          a toggle group (aria-pressed) so screen readers announce on/off, not
          colour alone. Persists to households.allergies. */}
      <div className="bg-white rounded-[18px] border border-light-grey p-6 md:p-7" style={{ boxShadow: CARD_SHADOW }}>
        <h2 className="text-lg font-semibold text-charcoal">Allergies &amp; dietary requirements</h2>
        <p className="text-sm text-[var(--ink-2)] mt-1.5 max-w-[620px] leading-relaxed">
          Select any allergens or dietary requirements for your household. The AI will avoid these when suggesting recipes and meals.
        </p>
        <div role="group" aria-label="Household allergens and dietary requirements" className="flex flex-wrap gap-2.5 mt-5 mb-6">
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
                aria-pressed={selected}
                onClick={() => toggleAllergy(key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  selected
                    ? 'bg-coral-light border-[1.5px] border-coral'
                    : 'bg-white text-warm-grey border border-light-grey hover:bg-[#F3EEE5]'
                }`}
                style={selected ? { color: '#C24E1F' } : undefined}
              >
                {selected && (
                  <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 6.2l2.6 2.6L10 3" stroke="#E8724A" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {label}
              </button>
            );
          })}
        </div>
        <button
          onClick={handleSaveAllergies}
          disabled={savingAllergies}
          className="bg-plum hover:bg-plum/90 disabled:opacity-50 text-white font-semibold px-7 py-3 rounded-[14px] text-[15px] transition-colors"
          style={{ boxShadow: '0 2px 8px rgba(108,61,217,0.3)' }}
        >
          {savingAllergies ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Add Dependent Modal */}
      {/* Household edit modal - name + address (with Photon autocomplete)
          + avatar upload. Backdrop click closes, Esc handled by the
          browser's natural button focus. Submit either patches settings
          and uploads the new avatar (if any) or clears it (if user
          tapped Remove photo). */}
      {showHouseholdEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={closeHouseholdEdit}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base md:text-lg font-medium text-bark">Edit household</h2>
              <button onClick={closeHouseholdEdit} className="text-cocoa hover:text-bark p-1" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="space-y-5">
              {/* Avatar preview + picker */}
              <div className="flex flex-col items-center gap-3">
                <label className="relative cursor-pointer group">
                  <img
                    src={hhEditAvatarPreview || '/family-placeholder2.png'}
                    alt="Household preview"
                    className="w-28 h-28 rounded-full object-cover ring-2 ring-white"
                  />
                  <span className="absolute inset-0 rounded-full bg-bark/0 group-hover:bg-bark/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <IconCameraSimple className="h-7 w-7 text-white" />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onAvatarFilePicked(e.target.files?.[0])}
                  />
                </label>
                <div className="flex items-center gap-3 text-xs">
                  <label className="text-plum hover:underline cursor-pointer">
                    Choose photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onAvatarFilePicked(e.target.files?.[0])}
                    />
                  </label>
                  {(household?.avatar_url || hhEditAvatarPreview) && (
                    <>
                      <span className="text-cream-border">·</span>
                      <button
                        type="button"
                        onClick={removeAvatarInEdit}
                        className="text-coral hover:underline"
                      >
                        Remove photo
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-bark mb-1">Household name</label>
                <input
                  type="text"
                  value={hhEditName}
                  onChange={(e) => setHhEditName(e.target.value)}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  placeholder="e.g. The Smiths"
                  autoFocus
                />
              </div>

              {/* Address with autocomplete */}
              <div>
                <label className="block text-sm font-medium text-bark mb-1">Home address</label>
                <div className="relative">
                  <input
                    type="text"
                    value={hhEditAddress}
                    onChange={(e) => setHhEditAddress(e.target.value)}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                    placeholder="Start typing your street address…"
                    autoComplete="off"
                  />
                  {hhAddressSearching && (
                    <span className="absolute right-3 top-2.5 text-xs text-cocoa">Searching…</span>
                  )}
                  {hhAddressSuggestions.length > 0 && (
                    <ul className="absolute z-10 w-full bg-white border border-cream-border rounded-lg mt-1 max-h-56 overflow-y-auto shadow-lg">
                      {hhAddressSuggestions.map((s) => (
                        <li key={s.id || s.label}>
                          <button
                            type="button"
                            onClick={() => {
                              setHhEditAddress(s.label);
                              setHhAddressSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-bark hover:bg-cream transition-colors"
                          >
                            {s.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-cocoa mt-1">Used for local-area suggestions (weather, nearby places). Optional.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={closeHouseholdEdit}
                className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveHousehold}
                disabled={hhEditSaving}
                className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors"
              >
                {hhEditSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddDependent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddDependent(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base md:text-lg font-medium text-bark">Add family member</h2>
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
                } flex items-center justify-center font-semibold text-xl`}>
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

              {/* School — now ONLY a term-calendar disambiguator, shown
                  only when the household has 2+ schools (otherwise the
                  single school is inferred and the child carries none).
                  Schools are added/managed in the Schools section above. */}
              {showSchools && householdSchools.length >= 2 && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1">School <span className="text-xs text-cocoa font-normal">(optional)</span></label>
                  <select
                    value={depSchoolId || ''}
                    onChange={(e) => setDepSchoolId(e.target.value || null)}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                  >
                    <option value="">Not sure / not applicable</option>
                    {householdSchools.map(s => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                  </select>
                  <p className="text-xs text-cocoa mt-1">Sets which school&apos;s term calendar applies to {depName.trim() || 'this child'} for term-only activities and reminders.</p>
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
              <h2 className="text-base md:text-lg font-medium text-bark">Add new member</h2>
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
                } flex items-center justify-center font-semibold text-xl`}>
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

              {/* School — only a term-calendar disambiguator, shown when the
                  household has 2+ schools. Lets you point an invited member
                  (e.g. a teen with their own login) at the right school's
                  term calendar. Schools are managed in the Schools section. */}
              {showSchools && householdSchools.length >= 2 && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1">School <span className="text-xs text-cocoa font-normal">(optional)</span></label>
                  <select
                    value={newSchoolId || ''}
                    onChange={(e) => setNewSchoolId(e.target.value || null)}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                  >
                    <option value="">Not sure / not applicable</option>
                    {householdSchools.map(s => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                  </select>
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
              <h2 className="text-base md:text-lg font-medium text-bark">Import term dates</h2>
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
                - the user already knows which type of school their kid
                attends, and each card's subtitle says when it applies. The
                top card varies by country: UK gets the LA import, SA gets
                the unified national term-date import. The three fallback
                cards (website / iCal / manual) are identical across
                countries - they're generic over school type. */}
            <div className="space-y-3">
              {/* Country-specific top card - UK: LA, SA: national. */}
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
                // The LA path resolves a council from GIAS and scrapes
                // their term-dates page. It only applies to state
                // schools — private/independent schools have no
                // local authority, so the button would just 400. When
                // we have no LA on the school record, demote the card
                // visually and point the user toward Website / PDF /
                // Manual instead.
                <div className={`bg-white rounded-xl border p-4 ${termDateSchoolLA ? 'border-cream-border' : 'border-cream-border/60 opacity-70'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-bark">🏛️ Import from local authority</h3>
                      <p className="text-xs text-cocoa mt-1">
                        {termDateSchoolLA
                          ? `Most state schools follow their council's term dates. We will import them from ${termDateSchoolLA} council.`
                          : "Doesn't apply to this school — there's no local authority on file (typical for private or independent schools). Use Import from school website or Upload the school's PDF instead."}
                      </p>
                    </div>
                    <button
                      onClick={handleImportLADates}
                      disabled={importingLA || !termDateSchoolLA}
                      className="shrink-0 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                    {importingWebsite ? 'Finding…' : 'Find dates'}
                  </button>
                </div>
              </div>

              {/* Option: Upload a PDF directly. Fallback for schools
                  that host the term-dates PDF behind SharePoint /
                  Google Drive share links (common at private schools)
                  or whose term-dates page is a JS-rendered SPA we
                  can't scrape. User downloads the PDF from their
                  browser and uploads it here. */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <h3 className="text-sm font-semibold text-bark">📄 Upload the school's PDF</h3>
                <p className="text-xs text-cocoa mt-1">If the website link above doesn't work, download the term-dates PDF from your browser and upload it.</p>
                <label className="mt-2 inline-flex items-center gap-2 cursor-pointer">
                  <span className="bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed transition-colors">
                    {importingPdf ? 'Reading…' : 'Choose PDF'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={importingPdf}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Reset the input so the same file can be picked
                      // again later (useful if a first parse failed).
                      e.target.value = '';
                      if (file) handleImportPdf(file);
                    }}
                    className="hidden"
                  />
                </label>
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

              {/* Option 4: Manual. Opens the "View & edit all dates"
                  panel with the Add-date form pre-expanded so the user
                  can start typing dates immediately. The same UI is
                  also reachable later via Edit child → Term dates →
                  View & edit all dates. */}
              <div className="bg-white rounded-xl border border-cream-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-bark">✏️ Add manually</h3>
                    <p className="text-xs text-cocoa mt-1">Enter term dates yourself, one at a time. Useful for schools without a published calendar URL.</p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-2 items-end">
                    {editingMember?.school_id && (
                      <button
                        onClick={() => {
                          setShowTermDateOptions(false);
                          setShowAllDates(true);
                          setShowAddTermDate(true);
                        }}
                        className="bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-pressed transition-colors"
                      >
                        Add now
                      </button>
                    )}
                    <button
                      onClick={() => setShowTermDateOptions(false)}
                      className="border border-cream-border text-cocoa text-xs font-medium px-4 py-2 rounded-lg hover:bg-sand transition-colors"
                    >
                      Skip for now
                    </button>
                  </div>
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
              <h2 className="text-base md:text-lg font-medium text-bark">{editingMember?.id === user?.id ? 'Edit profile' : `Edit ${editingMember?.name}`}</h2>
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
                  } flex items-center justify-center font-semibold text-2xl`}>
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

              {/* School — only a term-calendar disambiguator, shown when the
                  household has 2+ schools. Lets you pick which school's term
                  calendar applies to this member. With 0/1 schools it's
                  inferred from the household, so no picker is shown. Schools
                  are added/managed in the Schools section. */}
              {showSchools && householdSchools.length >= 2 && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1">School <span className="text-xs text-cocoa font-normal">(optional)</span></label>
                  <select
                    value={profileSchoolId || ''}
                    onChange={(e) => setProfileSchoolId(e.target.value || null)}
                    className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                  >
                    <option value="">Not sure / not applicable</option>
                    {householdSchools.map(s => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                  </select>
                  <p className="text-xs text-cocoa mt-1">Sets which school&apos;s term calendar applies for term-only activities and reminders.</p>
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

      {/* Review Imported Dates Panel - opens after /import-website/preview
          returns. Admin can edit any row, delete rows, and only commits
          to the DB on Save. Each row shows yellow warning chips from the
          server-side validator and an info button revealing the AI's
          source quote. */}
      {draftImport && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4" onClick={() => { if (!savingDraftImport) setDraftImport(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}

      {/* View & Edit All Dates Panel */}
      {showAllDates && termDateSchoolId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setShowAllDates(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}
    </div>
  );
}
