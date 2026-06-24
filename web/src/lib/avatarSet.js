// Illustrated-avatar set. A member can pick one of these instead of uploading
// a photo; the chosen id (e.g. 'set2/n07') is stored on users.avatar_id and
// resolved here to a public asset under web/public/avatars/.
//
// Avatar precedence (see components/ui/Avatar): photo -> illustration -> initial.

const SET = 'set2';
const COUNT = 60;

// Retired avatar ids: filtered out of the picker but never renumbered, so every
// other member's saved avatar_id keeps pointing at the same face.
const RETIRED = new Set([
  'set2/n02', 'set2/n11', 'set2/n13', 'set2/n20', 'set2/n24', 'set2/n33',
  'set2/n34', 'set2/n43', 'set2/n47', 'set2/n48', 'set2/n50',
  'set2/n53', 'set2/n54',
]);

// ['set2/n01', 'set2/n02', … 'set2/n60'] minus the retired ones
export const FAMILY_AVATARS = Array.from(
  { length: COUNT },
  (_, i) => `${SET}/n${String(i + 1).padStart(2, '0')}`,
).filter((id) => !RETIRED.has(id));

// 'set2/n07' -> '/avatars/set2/n07.png'. Returns null for falsy ids.
export function avatarSrc(id) {
  return id ? `/avatars/${id}.png` : null;
}
