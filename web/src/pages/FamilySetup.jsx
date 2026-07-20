import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import {
  IconEdit, IconMapPin, IconCameraSimple, IconPlus, IconTrash,
} from '../components/Icons';
import { useCanWrite } from '../context/SubscriptionContext';
import { hasSchoolsFeature } from '../lib/country';
import SubscribePrompt from '../components/SubscribePrompt';
import { loadCached } from '../lib/offlineCache';
import { pickPhoto } from '../lib/photo-picker';
import resizeImage from '../lib/resizeImage';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import { BottomSheet } from '../components/BottomSheet';
import Avatar from '../components/ui/Avatar';
import { hexFor } from '../lib/memberColors';
import { FAMILY_ROLES } from '../lib/familyRoles';
import { FAMILY_AVATARS } from '../lib/avatarSet';

// Soft warm sand for inset chips / day pills (shared literal across the
// redesigned pages - no exact theme token for this neutral).
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';
const CARD_SHADOW_HOVER = '0 4px 18px rgba(26, 22, 32, 0.10)';

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
  const fallback = isAdmin
    ? 'Admin'
    : (m.member_type === 'dependent' ? (m.dependent_kind === 'pet' ? 'Pet' : 'Kid') : 'Parent');
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
// WhatsApp brand glyph (green), shown next to a member's name when their
// number is linked. Path from the supplied whatsapp-color SVG.
// "What your assistant has learned" — the household_preferences rows the AI
// captures from chat/WhatsApp ("Lynn is allergic to nuts", "Tuesdays are
// soccer"). Families could never SEE these before, so a wrong inference was
// invisible and uncorrectable. Self-contained: fetches on mount, deletes with
// optimistic removal. Renders nothing while loading or when nothing has been
// learned yet (no empty-state card cluttering Family for new households).
const PREF_LABELS = {
  allergy: { icon: '🚫', label: 'Allergy' },
  dietary: { icon: '🥗', label: 'Dietary' },
  dislike: { icon: '🙅', label: 'Dislike' },
  like: { icon: '❤️', label: 'Like' },
  schedule: { icon: '🗓', label: 'Schedule' },
  preference: { icon: '💡', label: 'Note' },
};
function LearnedPreferencesCard({ cardShadow }) {
  const [prefs, setPrefs] = useState(null); // null = loading
  useEffect(() => {
    api.get('/household/preferences')
      .then((r) => setPrefs(Array.isArray(r.data?.preferences) ? r.data.preferences : []))
      .catch(() => setPrefs([]));
  }, []);

  async function removePref(id) {
    const prev = prefs;
    setPrefs(prefs.filter((p) => p.id !== id));
    try {
      await api.delete(`/household/preferences/${id}`);
    } catch {
      setPrefs(prev); // restore on failure
    }
  }

  if (!prefs || prefs.length === 0) return null;
  return (
    <div className="bg-white rounded-[18px] border border-light-grey p-6 md:p-7" style={{ boxShadow: cardShadow }}>
      <h2 className="text-lg font-semibold text-charcoal">What your assistant has learned</h2>
      <p className="text-sm text-[var(--ink-2)] mt-1.5 max-w-[620px] leading-relaxed">
        Things the AI has picked up from your chats — it factors these into meals, reminders and suggestions. Remove anything it got wrong.
      </p>
      <ul className="mt-5 space-y-2">
        {prefs.map((p) => {
          const meta = PREF_LABELS[p.key] || PREF_LABELS.preference;
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-cream px-4 py-2.5">
              <span aria-hidden="true">{meta.icon}</span>
              <span className="text-sm text-charcoal min-w-0 flex-1">
                <span className="font-semibold">{p.member_name || 'Everyone'}</span>
                <span className="text-warm-grey"> · {meta.label} · </span>
                {p.value}
              </span>
              <button
                onClick={() => removePref(p.id)}
                aria-label={`Remove learned ${meta.label.toLowerCase()}: ${p.value}`}
                className="text-warm-grey hover:text-coral shrink-0 p-1 transition-colors"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="WhatsApp connected">
      <g fill="none" fillRule="evenodd">
        <g transform="translate(-700,-360)" fill="#25D366">
          <path d="M723.993033,360 C710.762252,360 700,370.765287 700,383.999801 C700,389.248451 701.692661,394.116025 704.570026,398.066947 L701.579605,406.983798 L710.804449,404.035539 C714.598605,406.546975 719.126434,408 724.006967,408 C737.237748,408 748,397.234315 748,384.000199 C748,370.765685 737.237748,360.000398 724.006967,360.000398 L723.993033,360.000398 L723.993033,360 Z M717.29285,372.190836 C716.827488,371.07628 716.474784,371.034071 715.769774,371.005401 C715.529728,370.991464 715.262214,370.977527 714.96564,370.977527 C714.04845,370.977527 713.089462,371.245514 712.511043,371.838033 C711.806033,372.557577 710.056843,374.23638 710.056843,377.679202 C710.056843,381.122023 712.567571,384.451756 712.905944,384.917648 C713.258648,385.382743 717.800808,392.55031 724.853297,395.471492 C730.368379,397.757149 732.00491,397.545307 733.260074,397.27732 C735.093658,396.882308 737.393002,395.527239 737.971421,393.891043 C738.54984,392.25405 738.54984,390.857171 738.380255,390.560912 C738.211068,390.264652 737.745308,390.095816 737.040298,389.742615 C736.335288,389.389811 732.90737,387.696673 732.25849,387.470894 C731.623543,387.231179 731.017259,387.315995 730.537963,387.99333 C729.860819,388.938653 729.198006,389.89831 728.661785,390.476494 C728.238619,390.928051 727.547144,390.984595 726.969123,390.744481 C726.193254,390.420348 724.021298,389.657798 721.340985,387.273388 C719.267356,385.42535 717.856938,383.125756 717.448104,382.434484 C717.038871,381.729275 717.405907,381.319529 717.729948,380.938852 C718.082653,380.501232 718.421026,380.191036 718.77373,379.781688 C719.126434,379.372738 719.323884,379.160897 719.549599,378.681068 C719.789645,378.215575 719.62006,377.735746 719.450874,377.382942 C719.281687,377.030139 717.871269,373.587317 717.29285,372.190836 Z" />
        </g>
      </g>
    </svg>
  );
}

function MemberCard({ m, canEdit, canRemove, onEdit, onRemove, removing }) {
  const rm = roleMeta(m);
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group relative bg-white rounded-[18px] border border-light-grey px-5 py-[22px] flex flex-col items-center text-center gap-3"
      style={{ boxShadow: hover ? CARD_SHADOW_HOVER : CARD_SHADOW, cursor: canEdit ? 'pointer' : 'default', transition: 'box-shadow .2s ease' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={canEdit ? onEdit : undefined}
    >
      {(canEdit || canRemove) && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {canEdit && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label={`Edit ${m.name}`} className="p-1.5 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors">
              <IconEdit className="h-3.5 w-3.5" />
            </button>
          )}
          {canRemove && (
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} disabled={removing} aria-label={`Remove ${m.name}`} className="p-1.5 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors disabled:opacity-50 disabled:cursor-wait">
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <Avatar member={m} size={60} />
      <div className="flex items-center justify-center gap-1.5">
        <span className="text-base font-semibold text-charcoal">{m.name}</span>
        {m.whatsapp_linked && <WhatsAppIcon className="h-4 w-4 shrink-0" />}
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
      className="rounded-[18px] border-[1.5px] border-dashed border-light-grey bg-transparent flex flex-col items-center justify-center gap-3 min-h-[178px] text-warm-grey hover:border-plum/40 hover:text-plum transition-colors"
    >
      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: SOFT }}>
        <IconPlus className="h-6 w-6" />
      </div>
      <div className="text-sm font-semibold">{label}</div>
    </button>
  );
}

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
  const navigate = useNavigate();
  // Schools themselves (and term dates + activities) live on the School
  // page now — this flag only gates the per-member school DROPDOWN in the
  // add-dependent / add-member / edit-profile modals (a term-calendar
  // disambiguator shown when the household has 2+ schools).
  const showSchools = hasSchoolsFeature(household);

  // (Household name + address are now edited via the modal - see
  // hhEdit* state below. The old inline-textfield setup is gone.)
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
  // Add dependent state
  const [showAddDependent, setShowAddDependent] = useState(false);
  // Set of member-ids currently being deleted. Used to show a busy
  // affordance in the row while the (potentially slow) cascade RPC
  // runs, and to suppress duplicate clicks. The row itself is hidden
  // optimistically before the request fires.
  const [removingMemberIds, setRemovingMemberIds] = useState(() => new Set());
  const [depName, setDepName] = useState('');
  // 'child' | 'pet' - explicit, because children and pets share
  // member_type='dependent' and every kid-gated surface (Kids Mode, school
  // links, WhatsApp capture questions) needs to tell them apart reliably.
  // Dependents carry no family_role - the kind toggle replaced it.
  const [depKind, setDepKind] = useState('child');
  const [depBirthday, setDepBirthday] = useState('');
  const [depColor, setDepColor] = useState('teal');
  const [addingDependent, setAddingDependent] = useState(false);

  // School state
  const [depAttendsSchool, setDepAttendsSchool] = useState(false);
  const [depSchoolSearch, setDepSchoolSearch] = useState('');
  const [depSchoolResults, setDepSchoolResults] = useState([]);
  const [depSelectedSchool, setDepSelectedSchool] = useState(null);
  const [searchingSchools, setSearchingSchools] = useState(false);
  // UK custom-school fallback — when GIAS doesn't have the school
  // (private, alternative provision, very new, etc.), the user enters
  // it manually. school_name is required; postcode optional. school_urn
  // stays null so the LA-dates import doesn't try to resolve.
  const [depCustomSchoolMode, setDepCustomSchoolMode] = useState(false);
  const [depCustomSchoolName, setDepCustomSchoolName] = useState('');
  const [depCustomSchoolPostcode, setDepCustomSchoolPostcode] = useState('');
  const [householdSchools, setHouseholdSchools] = useState([]);

  // Edit profile state
  const [editingMember, setEditingMember] = useState(null);
  const [profileKind, setProfileKind] = useState('child'); // dependents only: 'child' | 'pet'
  const [profileName, setProfileName] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileColor, setProfileColor] = useState('teal');
  const [profileAvatar, setProfileAvatar] = useState(null); // uploaded photo URL
  const [profileAvatarId, setProfileAvatarId] = useState(''); // chosen illustrated-avatar id (e.g. 'set2/n07')
  const [profilePicker, setProfilePicker] = useState('avatar'); // 'avatar' | 'photo'
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false); // illustrated-avatar dropdown open?
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Separate flag for the household-card avatar quick-upload (different
  // from the per-member uploadingAvatar above). Lets us overlay a
  // loading state on the household photo without colliding with a
  // simultaneous member-profile upload.
  const [uploadingHouseholdAvatar, setUploadingHouseholdAvatar] = useState(false);
  // Household photo URL that failed to load - falls back to the placeholder
  // instead of a broken-image icon. Keyed on the URL so a re-upload retries.
  const [householdPhotoErrUrl, setHouseholdPhotoErrUrl] = useState(null);
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
  // A child's school link is now ONLY a term-calendar disambiguator,
  // surfaced as a dropdown when the household has 2+ schools. A child
  // carries no school otherwise (term context resolves from the
  // household's single school on the backend). These hold the dropdown
  // selection for the add-dependent / add-member modals; edit-profile
  // reuses the existing profileSchoolId.
  const [depSchoolId, setDepSchoolId] = useState(null);
  const [newSchoolId, setNewSchoolId] = useState(null);

  function loadMembers() {
    return loadCached(
      'household:members',
      () => api.get('/household').then(r => r.data?.members ?? []),
      (m) => setMembers(Array.isArray(m) ? m : []),
    )
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); loadSchools(); }, []);

  // Deep link from Settings -> the canonical profile editor:
  // /family?editProfile=1 opens the current user's edit-profile sheet once
  // members have loaded, then strips the param so a refresh/back won't reopen.
  const [searchParams, setSearchParams] = useSearchParams();
  const editProfileOpened = useRef(false);
  useEffect(() => {
    if (editProfileOpened.current) return;
    if (!searchParams.get('editProfile') || !members.length) return;
    const me = members.find((m) => m.id === user?.id);
    if (!me) return;
    editProfileOpened.current = true;
    openEditProfile(me);
    const next = new URLSearchParams(searchParams);
    next.delete('editProfile');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, members, user?.id]);

  function loadSchools() {
    loadCached(
      'schools',
      () => api.get('/schools').then(r => Array.isArray(r.data?.schools) ? r.data.schools : []),
      (sch) => setHouseholdSchools(sch),
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
    setDepKind('child');
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
        birthday: depBirthday || null,
        color_theme: depColor,
        school_id: schoolId,
        dependent_kind: depKind,
      });
      setShowAddDependent(false);
      await loadMembers();
      // Kid-gated surfaces (Kids' Notes nav, Child Mode card) listen for
      // this and appear the moment the first child is added.
      window.dispatchEvent(new Event('housemait:members-changed'));
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
      // Removing the last child hides the kid-gated surfaces again.
      window.dispatchEvent(new Event('housemait:members-changed'));
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

  // Account profiles are SOVEREIGN: each member edits only their OWN profile
  // - not even the admin edits another account-holder's. Children and pets
  // (dependents) have no login, so any account member may edit theirs.
  // Any managing adult may edit any member's profile (self, a child, or another
  // account-holder); non-managers can still edit themselves + children.
  function canEditProfile(m) {
    return !!m && (m.id === user?.id || m.member_type === 'dependent');
  }

  function openEditProfile(member) {
    if (!canEditProfile(member)) return;
    setEditingMember(member);
    setProfileName(member.name || '');
    setProfileRole(member.family_role || '');
    setProfileKind(member.dependent_kind === 'pet' ? 'pet' : 'child');
    setProfileBirthday(member.birthday || '');
    setProfileColor(member.color_theme || 'sage');
    setProfileAvatar(member.avatar_url || null);
    setProfileAvatarId(member.avatar_id || '');
    setProfilePicker(member.avatar_url ? 'photo' : 'avatar');
    setAvatarMenuOpen(false);
    setProfileSchoolId(member.school_id || null);
    setProfileAttendsSchool(Boolean(member.school_id));
    const school = householdSchools.find(s => s.id === member.school_id);
    setEditSchoolSearch(school?.school_name || '');
    setEditSchoolResults([]);
    setEditCustomSchoolMode(false);
    setEditCustomSchoolName('');
    setEditCustomSchoolPostcode('');
    // Activities + term dates are no longer managed inside the profile modal -
    // they live on the School page now. So there's nothing school-related
    // to pre-load here.
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
    // Always target the member being edited - not the logged-in user.
    const targetId = editingMember?.id;
    if (!targetId) return;
    setUploadingAvatar(true);
    try {
      const resized = await resizeImage(file);
      const formData = new FormData();
      formData.append('avatar', resized, resized.name);
      formData.append('userId', targetId);
      const { data } = await api.post('/household/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfileAvatar(data.avatar_url);
      setProfileAvatarId(''); // uploading a photo clears any chosen illustration
      setEditingMember(m => (m ? { ...m, avatar_url: data.avatar_url, avatar_id: null } : m));
      await loadMembers();
      // Only the current user's avatar lives in the auth context.
      if (targetId === user.id) login({ token, user: { ...user, avatar_url: data.avatar_url }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    const targetId = editingMember?.id;
    if (!targetId) return;
    setUploadingAvatar(true);
    try {
      await api.delete(`/household/profile/avatar?userId=${encodeURIComponent(targetId)}`);
      setProfileAvatar(null);
      setEditingMember(m => (m ? { ...m, avatar_url: null } : m));
      await loadMembers();
      if (targetId === user.id) login({ token, user: { ...user, avatar_url: null }, household });
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
        // Chosen illustrated avatar; the backend clears any photo when this is
        // set, and leaves the photo untouched when it's null.
        avatar_id: profileAvatarId || null,
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

      // Child/pet split only exists on dependents; the backend ignores it
      // for account members anyway, but don't send noise.
      if (editingMember?.member_type === 'dependent') {
        payload.dependent_kind = profileKind;
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
        const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor, avatar_id: profileAvatarId || null, ...(profileAvatarId ? { avatar_url: null } : {}) };
        login({ token, user: updatedUser, household });
      }
      setEditingMember(null);

      // If school changed to one with no term dates yet, hand over to the
      // School page - the whole term-date import machinery lives there now.
      if (schoolChanged) {
        const school = freshSchools.find(s => s.id === payload.school_id);
        if (school && (!school.term_dates || school.term_dates.length === 0)) {
          navigate('/school');
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
      const resized = await resizeImage(file);
      const form = new FormData();
      // Synthesize a filename for blobs that don't carry one.
      form.append('avatar', resized, resized.name || file.name || 'household.jpg');
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

  // Remove the family photo straight from the card (the obvious place to look,
  // vs. burying it in the Edit modal). Reuses the same DELETE the modal does.
  async function handleRemoveHouseholdAvatar() {
    if (!isAdmin || uploadingHouseholdAvatar) return;
    if (!window.confirm('Remove the family photo?')) return;
    setUploadingHouseholdAvatar(true);
    setError('');
    try {
      const { data } = await api.delete('/household/avatar');
      login({ token, user, household: data?.household || { ...household, avatar_url: null } });
      setSuccess('Family photo removed.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the photo.');
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
        const resized = await resizeImage(hhEditAvatarFile);
        const form = new FormData();
        form.append('avatar', resized, resized.name);
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
        actions={isAdmin ? (
          <PillBtn onClick={openHouseholdEdit} icon={<IconEdit className="h-3.5 w-3.5" />} aria-label="Edit household name">Edit</PillBtn>
        ) : null}
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
          <div className="relative shrink-0">
          <button
            type="button"
            disabled={!isAdmin || uploadingHouseholdAvatar}
            onClick={async () => {
              if (!isAdmin || uploadingHouseholdAvatar) return;
              const blob = await pickPhoto();
              if (blob) await handleDirectHouseholdAvatarUpload(blob);
            }}
            className={`block relative group rounded-[20px] overflow-hidden ${isAdmin && !uploadingHouseholdAvatar ? 'cursor-pointer' : 'cursor-default'}`}
            aria-label={isAdmin ? 'Upload a family photo' : 'Family photo'}
            title={isAdmin ? 'Upload a family photo' : ''}
          >
            {household?.avatar_url && householdPhotoErrUrl !== household.avatar_url ? (
              <img
                src={household.avatar_url}
                alt=""
                onError={() => setHouseholdPhotoErrUrl(household.avatar_url)}
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
            {isAdmin && household?.avatar_url && householdPhotoErrUrl !== household.avatar_url && !uploadingHouseholdAvatar && (
              <button
                type="button"
                onClick={handleRemoveHouseholdAvatar}
                aria-label="Remove family photo"
                title="Remove family photo"
                className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white text-[var(--ink-2)] hover:text-coral flex items-center justify-center shadow-md border border-[var(--cream-border)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>

          <div className="min-w-0">
            {/* Members: avatar stack + count */}
            <div className="flex items-center gap-3">
              <div className="flex" role="img" aria-label={`${members.length} member${members.length === 1 ? '' : 's'}: ${members.map(m => m.name).join(', ')}`}>
                {members.slice(0, 5).map((m, i) => (
                  <Avatar
                    key={m.id}
                    member={m}
                    size={32}
                    className="object-cover"
                    style={{ border: '2.5px solid #fff', marginLeft: i ? -10 : 0 }}
                  />
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
          <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
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
          <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
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

      {/* What the assistant has learned from chat - review + correct. Hidden
          until at least one preference exists. */}
      <LearnedPreferencesCard cardShadow={CARD_SHADOW} />

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
                <label className="block text-sm font-medium text-bark mb-1.5">Who are you adding?</label>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Child or pet">
                  {[['child', '🧒 Child'], ['pet', '🐾 Pet']].map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={depKind === kind}
                      onClick={() => setDepKind(kind)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${depKind === kind ? 'border-accent bg-accent/10 text-bark' : 'border-cream-border text-cocoa hover:bg-sand'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input type="text" value={depName} onChange={(e) => setDepName(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder={depKind === 'pet' ? 'e.g. Luna' : 'e.g. Sofia, Baby Oliver'} />
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
                  Schools are added/managed on the School page. */}
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
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white">
                  <option value="">Select role…</option>
                  {FAMILY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  {newRole && !FAMILY_ROLES.includes(newRole) && <option value={newRole}>{newRole}</option>}
                </select>
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
                  term calendar. Schools are managed on the School page. */}
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

      {/* Edit Profile Modal */}
      {editingMember && (
        <BottomSheet open onDismiss={() => setEditingMember(null)} desktopWidthClass="sm:w-[480px]">
          {/* overflow-x-hidden clips horizontal overflow from native iOS date
              inputs; min-h-0 lets the form scroll inside the sheet (the sheet
              caps height + adds the drag handle). */}
          <div className="overflow-y-auto overflow-x-hidden min-h-0 px-4 sm:px-6 pt-1 pb-4">
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
              {/* Avatar: an illustrated avatar from the set, or an uploaded photo */}
              <div className="flex flex-col items-center gap-3.5">
                <Avatar member={{ name: profileName, color_theme: profileColor, avatar_url: profileAvatar, avatar_id: profileAvatarId }} size={84} />
                {/* Avatar / Photo toggle */}
                <div className="inline-flex gap-1 p-1 rounded-[11px]" style={{ background: '#F3EEE5' }}>
                  {[['avatar', 'Avatar'], ['photo', 'Photo']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setProfilePicker(k)}
                      className="px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors"
                      style={profilePicker === k ? { background: '#fff', color: '#2D2A33', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { background: 'transparent', color: '#6B6774' }}>
                      {l}
                    </button>
                  ))}
                </div>
                {profilePicker === 'photo' ? (
                  <div className="flex items-center gap-3">
                    <label className={`text-sm font-medium cursor-pointer ${uploadingAvatar ? 'text-cocoa' : 'text-primary hover:text-primary-pressed'} transition-colors`}>
                      {uploadingAvatar ? 'Uploading…' : (profileAvatar ? 'Change photo' : 'Upload photo')}
                      <input type="file" accept="image/*" onChange={handleAvatarUpload} disabled={uploadingAvatar} className="hidden" />
                    </label>
                    {profileAvatar && (
                      <button type="button" onClick={handleAvatarRemove} disabled={uploadingAvatar} className="text-sm text-error hover:text-error/80 transition-colors">Remove</button>
                    )}
                  </div>
                ) : (
                  <div className="w-full relative">
                    {/* Dropdown trigger - opens the avatar grid below it */}
                    <button
                      type="button"
                      onClick={() => setAvatarMenuOpen((o) => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={avatarMenuOpen}
                      className="w-full flex items-center justify-between border border-cream-border rounded-lg pl-3 pr-3.5 py-2 bg-white text-sm"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        {profileAvatarId ? (
                          <img src={`/avatars/${profileAvatarId}.png`} alt="" className="w-7 h-7 rounded-full object-contain shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full shrink-0" style={{ background: hexFor({ color_theme: profileColor }) + '33' }} />
                        )}
                        <span className="text-bark truncate">{profileAvatarId ? 'Avatar selected' : 'Choose an avatar'}</span>
                      </span>
                      <svg className={`shrink-0 text-cocoa transition-transform ${avatarMenuOpen ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    {avatarMenuOpen && (
                      <div className="mt-2 rounded-lg border border-cream-border bg-white p-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 52px)', justifyContent: 'space-between', gap: '12px 8px', maxHeight: 200, overflowY: 'auto' }}>
                        {FAMILY_AVATARS.map((id) => {
                          const on = profileAvatarId === id && !profileAvatar;
                          const hex = hexFor({ color_theme: profileColor });
                          return (
                            <button key={id} type="button" onClick={() => { setProfileAvatarId(id); setProfileAvatar(null); setAvatarMenuOpen(false); }} aria-label="Choose avatar"
                              style={{ width: 52, height: 52, borderRadius: '50%', cursor: 'pointer', padding: 0, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', boxSizing: 'border-box', border: 'none', background: on ? hex + '33' : 'transparent', boxShadow: on ? `0 0 0 2px ${hex}` : 'none' }}>
                              <img src={`/avatars/${id}.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  placeholder="Your name"
                />
              </div>

              {editingMember?.member_type === 'dependent' && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1.5">Child or pet?</label>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Child or pet">
                    {[['child', '🧒 Child'], ['pet', '🐾 Pet']].map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={profileKind === kind}
                        onClick={() => setProfileKind(kind)}
                        className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${profileKind === kind ? 'border-accent bg-accent/10 text-bark' : 'border-cream-border text-cocoa hover:bg-sand'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Family role only means something for ADULTS (card label +
                  the chat AI's member context: "Lynn (Mother)"). Dependents
                  carry Child/Pet instead; their stored role, if any, is left
                  untouched (profileRole round-trips unchanged). */}
              {editingMember?.member_type !== 'dependent' && (
              <div>
                <label className="block text-sm font-medium text-bark mb-1">Family role</label>
                <div className="relative">
                  <select
                    value={profileRole}
                    onChange={(e) => setProfileRole(e.target.value)}
                    className="w-full appearance-none border border-cream-border rounded-lg pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
                  >
                    <option value="">Select role…</option>
                    {FAMILY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    {profileRole && !FAMILY_ROLES.includes(profileRole) && <option value={profileRole}>{profileRole}</option>}
                  </select>
                  <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-cocoa" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </div>
              </div>
              )}

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
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white"
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
                  are added/managed on the School page. */}
              {showSchools && householdSchools.length >= 2 && (
                <div>
                  <label className="block text-sm font-medium text-bark mb-1">School <span className="text-xs text-cocoa font-normal">(optional)</span></label>
                  <div className="relative">
                    <select
                      value={profileSchoolId || ''}
                      onChange={(e) => setProfileSchoolId(e.target.value || null)}
                      className="w-full appearance-none border border-cream-border rounded-lg pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white text-sm"
                    >
                      <option value="">Not sure / not applicable</option>
                      {householdSchools.map(s => <option key={s.id} value={s.id}>{s.school_name}</option>)}
                    </select>
                    <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-cocoa" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </div>
                  <p className="text-xs text-cocoa mt-1">Sets which school&apos;s term calendar applies for term-only activities and reminders.</p>
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
        </BottomSheet>
      )}

    </div>
  );
}
