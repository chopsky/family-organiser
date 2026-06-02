# Handoff: Housemait — "Up Next" card

## Overview

The **"Up Next" card** highlights the household's single most imminent calendar event on the Home screen. It exists in **two designs** depending on the home layout:

- **Variant A — Dashboard (light):** a white card with a brand-purple "UP NEXT · in 47 min" kicker, the event title, time/location, the responsible member's avatar, and a thin progress bar showing how close the event is.
- **Variant B — AI-first (dark hero):** a larger dark card with a purple radial glow, "NEXT UP" kicker, an Instrument-Serif title, time/location/drive-time line, and a driver badge.

Both are tappable and route to the Calendar. This bundle includes both so you can choose; they share the same data and intent.

## About the Design Files

The files here are **design references created in HTML/JSX** — prototypes of look and behavior, **not production code to ship directly**. Recreate the card in your target codebase's environment (React Native, SwiftUI, Flutter, React web, etc.) using its established components and styling system.

Platform mapping notes (the prototype is web-tech but the app is iOS-styled):
- **React Native / Expo:** `<div>`→`<View>`, `<span>`→`<Text>`, the card press→`<Pressable onPress>`. The dark variant's radial glow → an absolutely-positioned `<View>` with a `radial-gradient` (use `expo-linear-gradient`'s radial or a soft blurred circle / SVG `RadialGradient`).
- **SwiftUI:** `RoundedRectangle` backgrounds, the glow as a blurred `Circle().fill(RadialGradient(...))` clipped to the card, `Text` with `.font(.custom("InstrumentSerif-Regular", size: 24))` for the hero title.
- **React web:** the JSX is closest to usable — but swap inline styles for your styling solution and lift values from *Design Tokens*.

**Do not ship the JSX verbatim.** Lift the visual values and structure.

## Fidelity

**High-fidelity (hifi).** Colors, type, spacing, radii, and the dark-variant glow are final. Recreate pixel-perfectly with your primitives, and wire to your real calendar data (the prototype's event is static).

---

## Component: UpNextCard

### Purpose

Surface the next event so the family sees "what's happening soon" at a glance, with the responsible member and (in the hero variant) drive time and who's driving.

### Variant A — Dashboard (light)

```
┌─────────────────────────────────────────────┐
│  UP NEXT · IN 47 MIN                          │   ← brand-purple kicker
│  Mason · tennis                         (M)   │   ← title + member avatar
│  15:30–16:30 · Bishop's Park courts           │
│━━━━━━━──────────────────────────────────────  │   ← progress bar (brand fill)
└─────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Card | bg `#fff`, `border-radius:20px`, `border:1px solid rgba(26,22,32,0.07)`, `overflow:hidden`. Whole card is the tap target → Calendar. |
| Content padding | `16px 18px 14px` |
| Kicker | Inter 700, **11px**, `letter-spacing:0.1em`, `text-transform:uppercase`, color `#6C3DD9` (brand), `margin-bottom:2px`. Text: `Up next · in {n} min`. |
| Title | Inter 700, **18px**, color `#1A1620`, `letter-spacing:-0.3px`. |
| Sub-line | Inter 400, **13px**, color `#8A8493`, `margin-top:2px`. Text: `{start}–{end} · {location}`. |
| Avatar | Member avatar, **42px** (see *Avatar*), right-aligned, vertically centered. Header row is `flex` + `justify-content:space-between` + `align-items:center`. |
| Progress bar | Track: `height:6px`, bg `#F3EEE5` (`--bg-app-soft`). Fill: `height:100%`, bg `#6C3DD9` (brand), `width` = % of lead-up elapsed (prototype shows 18%). |

### Variant B — AI-first (dark hero)

```
┌─────────────────────────────────────────────┐ ◜ purple glow top-right
│  NEXT UP                                   ◜  │
│  Mason's tennis                               │   ← Instrument Serif 24px
│  15:30 · Bishop's Park courts · 8 min drive   │
│                                               │
│  (M)  You're driving                          │
└─────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Card | bg `#1A1620` (`--ink`), text `#fff`, `border-radius:24px`, `padding:18px 20px`, `position:relative`, `overflow:hidden`. Whole card taps → Calendar. |
| Glow | Absolutely positioned circle: `right:-30px; top:-30px; width:160px; height:160px; border-radius:50%`, `background: radial-gradient(circle, rgba(108,61,217,0.55), transparent 70%)`. Decorative, `aria-hidden`. All text sits in a `position:relative` layer above it. |
| Kicker | Inter 700, **11px**, `letter-spacing:0.1em`, uppercase, color `rgba(255,255,255,0.55)`, `margin-bottom:8px`. Text: `Next up`. |
| Title | **Instrument Serif**, **24px**, `letter-spacing:-0.4px`, white. |
| Sub-line | Inter 400, **13px**, color `rgba(255,255,255,0.7)`, `margin-top:4px`. Text: `{time} · {location} · {driveTime}`. |
| Driver row | `margin-top:14px`, `flex`, `align-items:center`, `gap:8px`: a **28px** member avatar + label Inter 400 12px `rgba(255,255,255,0.7)` (e.g. "You're driving"). |

### Avatar (shared primitive)

A solid colored circle with the member's initial.

| Property | Value |
|---|---|
| Shape | `border-radius:50%`, square `size × size` |
| Background | the member's assigned `color` (see *Member colors*) |
| Text | white, Inter 600, font-size `size * 0.42`, `letter-spacing:-0.2px`, centered |
| Sizes used | 42px (light variant), 28px (hero driver) |

---

## Interactions & Behavior

| Trigger | Result |
|---|---|
| Tap the card (either variant) | Navigate to the Calendar / event detail. |

- No expand/collapse, no internal scroll. Single static card.
- Hover (web only, optional): subtle lift — `transform: translateY(-1px)` + slightly stronger shadow on the light card; ~5% lighter bg on the dark card.
- **Accessibility:** expose as a button/link with a label like "Up next: Mason's tennis at 15:30, Bishop's Park courts. Opens calendar." Avatar initials are decorative if the name is already in the label; otherwise give the avatar an `aria-label` of the member name. The glow is `aria-hidden`.

---

## State Management & Data

The card is **presentational** — it receives the next event. Compute "the next event" upstream from the household calendar:

```ts
type Member = { id: string; name: string; short: string; color: string };

type UpNextEvent = {
  title: string;        // 'Mason · tennis'
  time: string;         // '15:30'  (start)
  end: string;          // '16:30'
  loc: string;          // "Bishop's Park courts"
  who: string;          // member id responsible / attending
  inMins: number;       // minutes until start → "in 47 min"
  progress: number;     // 0–1, lead-up elapsed, for the light bar

  // hero-variant extras
  heroTitle: string;    // "Mason's tennis"
  heroSub: string;      // "15:30 · Bishop's Park courts · 8 min drive"
  heroDriver: string;   // member id of the driver
  heroDriverLabel: string; // "You're driving"
};
```

### Sourcing in production
1. From the household calendar, pick the soonest upcoming event (start ≥ now).
2. `inMins = round((start - now) / 60000)`. Render `in {inMins} min` when < 60, else `at {time}` or `in {h}h {m}m` — pick a rule that reads well; the prototype only shows the minutes case.
3. `progress` (light bar): map a lead-up window to 0–1. E.g. window = 60 min before start; `progress = clamp(1 - inMins/60, 0, 1)`. Tune to taste.
4. Hero `driveTime` ("8 min drive"): from a maps/ETA call using the event location; omit the segment if unavailable.
5. Hero `driverLabel`: "You're driving" if the current user is the driver, else "{Name} is driving". Omit the driver row if no driver assigned.
6. If there is **no** upcoming event, hide the card entirely (don't show an empty state here).

---

## Design Tokens

### Colors

| Token | Hex / value | Use |
|---|---|---|
| `--ink` | `#1A1620` | Hero bg; light-variant title |
| `--ink-2` | `#4A4453` | (not used directly here) |
| `--ink-3` | `#8A8493` | Light-variant sub-line |
| `--line` | `rgba(26,22,32,0.07)` | Light card border |
| `--bg-app-soft` | `#F3EEE5` | Light progress-bar track |
| `--brand` | `#6C3DD9` | Kicker, progress fill, glow color |
| `--brand-soft` | `#EFE9FB` | (sibling components) |
| White alphas | `rgba(255,255,255,0.55 / 0.7)` | Hero kicker / sub-text |
| Glow | `radial-gradient(circle, rgba(108,61,217,0.55), transparent 70%)` | Hero decoration |

### Member colors

| Member | Initial | Color |
|---|---|---|
| Grant | G | `#6BA368` |
| Emma | E | `#D8788A` |
| Mason | M | `#5B8DE0` |
| Lily | L | `#D89B3A` |

(These are the household's assigned avatar colors — use whatever your real member records carry.)

### Typography

| Use | Family | Weight | Size | Notes |
|---|---|---|---|---|
| Kicker (both) | Inter | 700 | 11 | letter-spacing 0.1em, uppercase |
| Title (light) | Inter | 700 | 18 | letter-spacing -0.3 |
| Title (hero) | Instrument Serif | 400 | 24 | letter-spacing -0.4 |
| Sub-line (both) | Inter | 400 | 13 | |
| Driver label | Inter | 400 | 12 | |
| Avatar initial | Inter | 600 | size×0.42 | |

Fonts: **Inter** (400/600/700) and **Instrument Serif** (roman). Add to your font pipeline if self-hosted.

### Radii & spacing

- Radii: `20px` (light card) · `24px` (hero card) · `50%` (avatars, glow).
- Padding: light content `16px 18px 14px`; hero `18px 20px`.
- Progress bar height `6px`. Glow `160×160` at `right/top:-30px`.
- Avatars: 42px (light), 28px (hero).

---

## Assets

No image assets. Avatars are CSS circles with initials. The hero glow is a CSS radial gradient. No icons on these cards.

---

## Files

- **`preview.html`** — open in a browser to see both variants stacked.
- **`up-next-card.jsx`** — `UpNextLight` and `UpNextHero` components plus an inlined `Avatar` and demo data. The components to recreate in your framework.

### Where it lives in the prototype
`src/screens-home.jsx` — `UpNextLight` ≈ the featured `Card` near the top of `HomeDashboard`; `UpNextHero` ≈ the dark "Next up" card near the top of `HomeAIFirst`. Both sit high on the Home screen, just below the AI composer / greeting.

---

## Implementation checklist

- [ ] Pick the variant(s) you want (light, hero, or both per layout)
- [ ] Card is a single tap target → Calendar
- [ ] "Next event" computed from the real calendar; card hidden when none
- [ ] `inMins` formatting rule chosen (min / at-time / h+m)
- [ ] Light: progress bar maps lead-up window to 0–1
- [ ] Hero: glow rendered behind a relative text layer; `aria-hidden`
- [ ] Hero: drive-time + driver row populated, segments omitted when unknown
- [ ] Member avatar uses real member color + initial
- [ ] Fonts loaded (Inter + Instrument Serif for hero title)
- [ ] Tokens added to your design system
- [ ] Accessible label on the card; decorative glow hidden
