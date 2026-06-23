// Illustrated-avatar set. A member can pick one of these instead of uploading
// a photo; the chosen id (e.g. 'set2/n07') is stored on users.avatar_id and
// resolved here to a public asset under web/public/avatars/.
//
// Avatar precedence (see components/ui/Avatar): photo -> illustration -> initial.

const SET = 'set2';
const COUNT = 58;

// ['set2/n01', 'set2/n02', … 'set2/n52']
export const FAMILY_AVATARS = Array.from(
  { length: COUNT },
  (_, i) => `${SET}/n${String(i + 1).padStart(2, '0')}`,
);

// 'set2/n07' -> '/avatars/set2/n07.png'. Returns null for falsy ids.
export function avatarSrc(id) {
  return id ? `/avatars/${id}.png` : null;
}
