# Handoff: Housemait — "After School" dashboard widget

## Overview

A Home-screen dashboard card that shows the **kids' after-school activities** for a chosen weekday. It has a **Mon–Fri day selector** at the top; tapping a day filters the list to that day's clubs. Each row shows the start time, an activity glyph tinted to the child's color, the activity name, the child + location, and **who is on pickup** (parent name + avatar). It answers the daily question "who has what after school, and who's collecting them?"

## About the Design Files

The files here are **design references created in HTML/JSX** — a prototype of look and behavior, **not production code to ship directly**. Recreate the widget in your target codebase's environment (React Native, SwiftUI, Flutter, React web, etc.) using its established components and styling system.

Platform mapping notes (the prototype is web-tech, the app is iOS-styled):
- **React Native / Expo:** `<div>`→`<View>`, `<span>`/text→`<Text>`, day pills + rows→`<Pressable>`, the SVG glyphs→`react-native-svg`. The `kid.color + '1F'` hex-alpha tile background works as a normal color string in RN too.
- **SwiftUI:** day pills as a segmented row of `Button`s, glyphs as SF Symbols (or custom), the tinted tile as `RoundedRectangle().fill(kidColor.opacity(0.12))`.
- **React web:** the JSX is closest to usable — swap inline styles for your styling system and lift values from *Design Tokens*.

**Do not ship the JSX verbatim.** Lift the visual values, layout, and interaction model.

## Fidelity

**High-fidelity (hifi).** Colors, type, spacing, the tinted icon tiles, and the day-selector interaction are final. Recreate pixel-perfectly with your primitives and wire to your real activities data (the prototype's list is static).

---

## Component: AfterSchool

### Purpose

Give parents an at-a-glance read of each child's after-school commitments per weekday, including the pickup owner, without opening the full calendar.

### Anatomy

```
┌──────────────────────────────────────────────┐
│ THE KIDS                              Calendar›│  ← eyebrow + title + action
│ After school                                   │
│                                                │
│ ┌MON┐┌TUE┐┌WED┐┌THU┐┌FRI┐                      │  ← day pills (active = purple)
│ │ • ││ • ││ • ││ • ││ • │                       │     dot = has clubs that day
│ └───┘└───┘└───┘└───┘└───┘                      │
│                                                │
│ 15:45  [▦]  Football training        PICKUP    │  ← activity row
│             Mason · School pitch     Grant (G) │
│ 15:30  [▦]  Art club                 PICKUP    │
│             Lily · Room 4            Emma  (E) │
└──────────────────────────────────────────────┘
```

### Container

- Uses the app's standard **Card**: bg `#fff`, `border-radius:22px`, `padding:18px`, shadow `0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)`.
- Standard **CardHeader**: eyebrow "THE KIDS" (11px, 600, uppercase, `letter-spacing:0.08em`, color `--ink-3`), title "After school" (17px, 700, `letter-spacing:-0.2`, color `--ink`), and a right-aligned "Calendar ›" action button (13px, 600, color `--brand`) that routes to the Calendar. `margin-bottom:14px`.

### Day selector (Mon–Fri)

A `flex` row, `gap:6px`, `margin-bottom:14px`. Five equal pills (`flex:1`).

Each pill is a `button`: `padding:8px 0 7px`, `border-radius:12px`, no border, `flex-column`, centered, `gap:5px`, `transition: background .15s ease`.

| State | Background | Label color | Dot |
|---|---|---|---|
| **Active** | `--brand` (`#6C3DD9`) | `#fff` | `rgba(255,255,255,0.85)` if day has clubs |
| **Inactive** | `--bg-app-soft` (`#F3EEE5`) | `--ink-2` (`#4A4453`) | `--brand` if day has clubs |
| (no clubs) | — | — | dot is `transparent` |

- Label: the 3-letter day, 11px, 700, `letter-spacing:0.04em`.
- Dot: `5×5`, `border-radius:50%`, sits below the label; signals at a glance which days have activities.
- Default selected day: `MON` (configurable; in production default to **today** when it's a weekday, else the next school day).

### Activity row

`flex`, `align-items:center`, `gap:12px`. Rows stacked in a `flex-column`, `gap:10px`.

| Element | Spec |
|---|---|
| **Time** | `width:42px` (fixed, `flex-shrink:0`), Inter 600, 13px, color `--ink-3`, `font-variant-numeric:tabular-nums` (keeps times aligned). Shows start time, e.g. `15:45`. |
| **Icon tile** | `38×38`, `border-radius:11px`, `flex-shrink:0`, centered. Background = **the child's color at ~12% alpha** (`kidColor + '1F'`). Glyph 20px in the child's solid color. |
| **Title + location** | `flex:1`, `min-width:0`. Title (activity): Inter 600, 14px, `--ink`, truncated with ellipsis. Sub: Inter 400, 12px, `--ink-3`, format `{childName} · {location}`, truncated. |
| **Pickup** | `flex`, `align-items:center`, `gap:6px`, `flex-shrink:0`. A right-aligned two-line label — "PICKUP" (9px, 700, uppercase, `letter-spacing:0.08em`, `--ink-3`) over the parent name (11px, 600, `--ink-2`) — followed by a **26px** Avatar of the pickup parent. |

### Empty state

When the selected day has no activities, replace the list with a centered line: *"No clubs — straight home."* — Inter 400, 13px, `--ink-3`, italic, `padding:18px 0`.

### Avatar (shared primitive)

Solid colored circle with the member's initial: `border-radius:50%`, background = member color, white initial, Inter 600 at `size*0.42`, `letter-spacing:-0.2`. Used at 26px here.

---

## Interactions & Behavior

| Trigger | Result |
|---|---|
| Tap a day pill | Select that day; list re-renders to its activities; pill turns purple. |
| Tap "Calendar ›" | Navigate to the Calendar screen. |

- No horizontal scroll; exactly five pills span the width.
- State is local (`selectedDay`). Persisting it isn't necessary — default to today/next school day on mount.
- **Accessibility:** day pills are a single-select group — expose as `role="tablist"` / segmented control with the active pill `aria-selected`. Each row should have a label like "Football training, Mason, 15:45 at School pitch, pickup Grant." Glyphs are decorative (`aria-hidden`); the info is in the text.

---

## State Management & Data

The widget is presentational. It takes the activities list and tracks the selected day:

```ts
type Activity = {
  id: string;
  day: 'MON'|'TUE'|'WED'|'THU'|'FRI';
  who: string;       // child member id
  activity: string;  // 'Football training'
  icon: IconKey;     // 'ball'|'tennis'|'art'|'ballet'|'code'|'swim'|'music'|'gym'
  time: string;      // start 'HH:MM'
  end: string;       // end 'HH:MM' (not currently shown; available for detail)
  loc: string;       // 'School pitch'
  pickup: string;    // parent member id responsible for collection
};

// local UI state
const [selectedDay, setSelectedDay] = useState<Day>(/* today or next school day */);
```

### Sourcing in production
1. Pull recurring after-school clubs for each child from your calendar/activities store, keyed by weekday.
2. Resolve `who` → child record (name + color) and `pickup` → parent record (name + avatar) from your household members.
3. Map each activity to an icon. Extend the icon set as needed (see *Assets*) and fall back to a generic glyph if no match.
4. Default `selectedDay` to today if it's Mon–Fri, otherwise the next school day.
5. Sort each day's rows by start time.

The **child's color** drives both the icon tile tint and glyph color — pull it from the child's member record (don't hard-code).

---

## Design Tokens

### Colors

| Token | Hex / value | Use |
|---|---|---|
| `--ink` | `#1A1620` | Title, activity name |
| `--ink-2` | `#4A4453` | Inactive pill label, pickup name |
| `--ink-3` | `#8A8493` | Eyebrow, time, location, "PICKUP", empty state |
| `--line` | `rgba(26,22,32,0.07)` | (card border in app) |
| `--bg-app-soft` | `#F3EEE5` | Inactive pill background |
| `--brand` | `#6C3DD9` | Active pill, dots, action link |
| Child tile tint | `childColor + '1F'` | Icon tile bg (~12% alpha of the child color) |

### Member colors (demo)

| Member | Role | Initial | Color |
|---|---|---|---|
| Grant | Parent (pickup) | G | `#6BA368` |
| Emma | Parent (pickup) | E | `#D8788A` |
| Mason | Kid, 11 | M | `#5B8DE0` |
| Lily | Kid, 8 | L | `#D89B3A` |

### Typography

| Use | Family | Weight | Size | Notes |
|---|---|---|---|---|
| Eyebrow | Inter | 600 | 11 | uppercase, ls 0.08em |
| Title | Inter | 700 | 17 | ls -0.2 |
| Action link | Inter | 600 | 13 | brand color |
| Day-pill label | Inter | 700 | 11 | ls 0.04em |
| Row time | Inter | 600 | 13 | tabular-nums |
| Activity name | Inter | 600 | 14 | |
| Row sub-line | Inter | 400 | 12 | |
| "PICKUP" | Inter | 700 | 9 | uppercase, ls 0.08em |
| Pickup name | Inter | 600 | 11 | |
| Empty state | Inter | 400 (italic) | 13 | |

Font: **Inter** (400/600/700). (No Instrument Serif on this widget.)

### Radii & spacing

- Radii: `11px` (icon tile) · `12px` (day pill) · `22px` (card) · `50%` (avatar).
- Card padding `18px`. Header `margin-bottom:14px`. Day row `gap:6px`, `margin-bottom:14px`. Activity list `gap:10px`. Row `gap:12px`.
- Sizes: icon tile `38×38`, glyph `20px`, avatar `26px`, time column `42px`, dot `5px`.

---

## Assets

All icons are **inline SVG**, no asset files. Activity glyphs (24px viewBox, 1.7px stroke, matching the app's icon weight) live in `after-school-widget.jsx` → `AS_ICONS`:

`ball` (football) · `tennis` · `art` · `ballet` · `code` · `swim` · `music` (choir) · `gym`.

Add more keys for other clubs (drama, chess, scouts…) following the same stroke style, or map to your platform's icon library. Avatars are CSS circles with initials.

No raster images.

---

## Files

- **`preview.html`** — open in a browser to see the widget live (tap the day pills).
- **`after-school-widget.jsx`** — the `AfterSchool` component, self-contained (Card/CardHeader/Avatar + icons + demo data inlined). The component to recreate in your framework.

### Where it lives in the prototype
`src/screens-home.jsx` — component `AfterSchool`, rendered on the Dashboard home (`HomeDashboard`) just after the "Today's schedule" card. Activity data is in `src/data.jsx` as `ACTIVITIES` / `ACTIVITY_DAYS`.

---

## Implementation checklist

- [ ] Card placed on the dashboard (after Today's schedule, or wherever fits your layout)
- [ ] Five Mon–Fri pills, single-select, active = brand purple
- [ ] Per-day dot indicator (shows which days have clubs)
- [ ] Default selected day = today (or next school day) on mount
- [ ] Rows sorted by start time; time column uses tabular figures
- [ ] Icon tile tinted to the **child's** color; glyph in the child's color
- [ ] Activity name + "{child} · {location}" sub-line, both truncate cleanly
- [ ] Pickup label + parent avatar on the right
- [ ] Empty state ("No clubs — straight home.") when a day has none
- [ ] Activities sourced from real data; members resolved for color/avatar
- [ ] Icon map covers your real clubs (+ a fallback glyph)
- [ ] "Calendar ›" routes to the calendar
- [ ] Fonts loaded (Inter); tokens added to your design system
- [ ] Accessible: pills as a selectable group, descriptive row labels, glyphs hidden
