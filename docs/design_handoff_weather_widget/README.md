# Handoff: Housemait Home — Weather widget

## Overview

A compact, collapsible weather card that sits on the **Home screen of the Housemait iOS app**, directly **above the AI composer** (the "Ask, plan, or scan…" input). At rest it shows only current conditions in a single row to stay light on vertical space; tapping it expands a 24-hour, horizontally-swipeable forecast plus a context-aware AI nudge. It appears in both home variations (Dashboard and AI-first).

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** — a prototype showing intended look and behavior, **not production code to copy directly**. The task is to **recreate this widget in your target codebase's environment** (React Native, SwiftUI, Flutter, a React web app, etc.) using its established patterns, component primitives, and styling system.

Because Housemait's prototype is iOS-styled but built in web tech, note:
- If the real app is **React Native / Expo**: map `<div>`→`<View>`, `<button>`→`<Pressable>`, `<span>`→`<Text>`, the horizontal scroller→`<ScrollView horizontal>`, and the SVG glyphs→`react-native-svg`. The `grid-template-rows` expand trick is web-only — use `LayoutAnimation` or `react-native-reanimated` for the height animation instead.
- If the real app is **SwiftUI**: this maps cleanly to a `DisclosureGroup`-like pattern with a horizontal `ScrollView`, `Image(systemName:)` SF Symbols in place of the custom glyphs, and `.animation(.easeInOut)` on the expand.
- If it's a **React web app**: the JSX is closest to usable, but replace inline-style objects with your styling solution (Tailwind / CSS Modules / styled-components) and lift the values from the *Design Tokens* section.

**Do not ship the JSX verbatim.** Lift the visual values, layout, and interaction model — not the styling approach.

## Fidelity

**High-fidelity (hifi).** Colors, typography, spacing, the collapse/expand interaction, and the swipe behavior are all final and intentional. Recreate pixel-perfectly using your codebase's primitives — but wire it to **real weather data** (the prototype's forecast is static).

---

## Component: WeatherStrip

### Purpose

Give the household an at-a-glance read on today's weather without dominating the home screen, and surface one smart, plain-language nudge ("Dry through Mason's tennis at 15:30") that ties the forecast to the family's actual schedule.

### Anatomy

```
COLLAPSED (default)
┌─────────────────────────────────────────────┐
│  ┌────┐   16°  Partly sunny              ⌄  │   ← tap anywhere to expand
│  │ ☀️⛅│   Fulham  H 18°·L 9°  10% rain      │
│  └────┘                                      │
└─────────────────────────────────────────────┘

EXPANDED (after tap)
┌─────────────────────────────────────────────┐
│  ┌────┐   16°  Partly sunny              ⌃  │   ← chevron now rotated 180°
│  │ ☀️⛅│   Fulham  H 18°·L 9°  10% rain      │
│  └────┘                                      │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  →  (swipe, 24h)  │   ← horizontal scroll
│  │Now││13││14││15││16││17│ …                 │
│  │16°││17°││18°││17°││15°││14°│               │
│  └──┘└──┘└──┘└──┘└──┘└──┘                    │
│  ✦  Dry through Mason's tennis at 15:30      │   ← taps to AI composer
└─────────────────────────────────────────────┘
```

### Layout & container

- Outer card: `border-radius: 20px`, `border: 1px solid rgba(26,22,32,0.07)`, `overflow: hidden`.
- Background: `linear-gradient(135deg, #EAF1FB 0%, #F4F0FB 52%, #FBF1E4 100%)` — a soft blue→lilac→peach "sky" wash. This is the only element on the home screen with this gradient, so it reads instantly as weather.
- Full width of the home content column (the home screen uses `padding: 0 20px`, so the card spans that inner width; on a 390px screen the card is ~350px wide).
- Placed in the home content stack **immediately above the AI composer**, with the stack's `gap: 18px` providing separation.

### Region 1 — Current conditions (always visible, is the tap target)

A single full-width `button` (so the entire row is tappable and accessible). `padding: 14px 16px`, `display:flex`, `align-items:center`, `gap:14px`, transparent background, no border.

| Sub-element | Spec |
|---|---|
| **Icon chip** | 46×46, `border-radius:14px`, bg `rgba(255,255,255,0.7)`, border `1px solid rgba(255,255,255,0.9)`, centered glyph. Glyph 28px, colored per condition (see *Condition colors*). `flex-shrink:0`. |
| **Temp** | Instrument Serif, **34px**, line-height 1, `letter-spacing:-0.5px`, color `#1A1620`. Trailing `°`. |
| **Condition label** | Inter 600, 13px, color `#4A4453`, baseline-aligned with temp, `gap:8px` from it. |
| **Meta row** | Inter 400, 12px, color `#8A8493`, `margin-top:3px`, `display:flex`, `gap:10px`, **`white-space:nowrap`** (prevents the H/L from wrapping on narrow screens). Three spans: city · `H {high}° · L {low}°` · `{rain}% rain`. |
| **Chevron** | 18px down-chevron, color `#8A8493`, `flex-shrink:0`. Rotates `0deg → 180deg` when expanded, `transition: transform .25s ease`. |

The middle text block is `flex:1; min-width:0` so it absorbs remaining width and the chevron stays pinned right.

### Region 2 — Expandable (hourly + AI note)

Wrapped in the CSS expand pattern:
```
display:grid; grid-template-rows: <0fr collapsed | 1fr expanded>;
transition: grid-template-rows .28s ease;
> inner div: overflow:hidden;
```
This animates height smoothly with no fixed pixel value. **On native platforms**, replace with the platform's height/disclosure animation (~280ms ease).

#### Hourly forecast (horizontally swipeable)

- Container: `display:flex`, `gap:4px`, `overflow-x:auto`, `padding:0 12px 12px`.
  - `-webkit-overflow-scrolling:touch` for momentum; `scroll-snap-type:x proximity`.
  - Scrollbar hidden via the app's `.ios-scroll` utility (`::-webkit-scrollbar{display:none}` + `scrollbar-width:none`).
- **24 hour-cells**, starting with "Now", running forward through the night into tomorrow morning. The user swipes with a finger to reveal the rest.
- Each cell: `flex:1 0 auto`, `min-width:52px`, `text-align:center`, `scroll-snap-align:start`, `padding:8px 6px`, `border-radius:13px`.
  - Time label: Inter 600, 11px, `margin-bottom:6px`. "Now" cell label is `#1A1620`; all others `#8A8493`.
  - Glyph: 18px, colored per condition, `margin-bottom:5px`.
  - Temp: Inter 600, 13px, `#1A1620`, `font-variant-numeric:tabular-nums` (so columns align).
  - **"Now" cell only** gets a highlight: bg `rgba(255,255,255,0.8)`, border `1px solid rgba(255,255,255,0.95)`. All other cells have transparent bg + transparent 1px border (keeps widths identical).

> **Note:** the container's `padding-left:12px` gives the highlighted "Now" cell a proper gap from the card edge — don't drop below 12px or the highlight sits flush against the edge.

#### AI note (bottom row)

A full-width `button`. `padding:10px 16px`, `border-top:1px solid rgba(26,22,32,0.05)`, bg `rgba(255,255,255,0.4)`, `display:flex`, `align-items:center`, `gap:8px`.
- Sparkle glyph 13px, color `#6C3DD9` (brand).
- Text: Inter 500, 12px, color `#4A22A8` (brand-deep). Content is the AI-generated `note`.
- Tapping it opens the app's **AI composer** (same action as focusing the composer below).

---

## Interactions & Behavior

| Trigger | Result |
|---|---|
| Tap the current-conditions row (anywhere) | Toggle expanded/collapsed. Chevron rotates 180°. Height animates ~280ms ease. |
| Swipe the hourly strip horizontally | Scrolls through all 24 hours with momentum; gently snaps to each hour. |
| Tap the AI note | Opens the AI composer (`onOpenAI` callback). |

- **Default state is collapsed.** Persisting the open/closed choice is optional; the prototype resets to collapsed on mount. If you want it sticky, store a boolean in local storage / app state.
- No hover states needed (touch-first). On a web build, you may add a subtle `background: rgba(255,255,255,0.25)` on row hover.
- **Accessibility:** the conditions row carries `aria-expanded`. Add an `aria-label` like "Weather, 16 degrees, partly sunny. Tap to expand hourly forecast." Decorative glyphs should be `aria-hidden`. The AI-note button should have an explicit label.

---

## State Management & Data

### Local UI state
```ts
const [open, setOpen] = useState(false);  // expand/collapse
```

### Weather data shape
```ts
type Condition = 'sun' | 'partly' | 'cloud' | 'rain';

type Weather = {
  city: string;        // 'Fulham'
  now: number;         // current temp, whole degrees
  cond: string;        // human label, 'Partly sunny'
  icon: Condition;     // drives the big glyph + chip color
  high: number;        // today's high
  low: number;         // today's low
  rain: number;        // precip probability %, current
  note: string;        // AI-generated nudge (see below)
  hours: Array<{       // 24 entries
    t: string;         // 'Now' | 'HH:00'
    tmp: number;       // temp, whole degrees
    icon: Condition;
  }>;
};
```

### Production data sourcing
The prototype data is **static**. In production:
1. Resolve the household's location (saved address, or device location with permission). The prototype hard-codes "Fulham".
2. Fetch from your chosen weather provider (OpenWeather One Call, Apple WeatherKit, Met Office DataHub, etc.). Map the provider's condition codes onto the four buckets `sun | partly | cloud | rain` (collapse all rain/storm/drizzle → `rain`, overcast → `cloud`, few-clouds → `partly`, clear → `sun`). Extend the bucket set + `WX_COLOR` map if you want snow/fog/storm variants.
3. Build the `hours` array as 24 forward hours from now, first labeled "Now".
4. Units: the prototype shows whole-degree **Celsius**. Honor the user's unit preference.

### The AI `note`
This is the one genuinely "smart" field: a single short sentence that ties the forecast to the family's schedule (the prototype: *"Dry through Mason's tennis at 15:30"*). Generate it server-side by passing the day's forecast + today's calendar events to your LLM with a tight prompt ("one sentence, ≤10 words, plain, actionable, reference an event if weather is relevant"). If you can't generate one, **omit the AI-note row entirely** — don't show a generic placeholder.

---

## Design Tokens

### Colors

| Token | Hex / value | Use |
|---|---|---|
| `--ink` | `#1A1620` | Temp, "Now" labels, hourly temps |
| `--ink-2` | `#4A4453` | Condition label |
| `--ink-3` | `#8A8493` | Meta row, non-now labels, chevron |
| `--line` | `rgba(26,22,32,0.07)` | Card border |
| `--brand` | `#6C3DD9` | Sparkle glyph |
| `--brand-deep` | `#4A22A8` | AI-note text |
| Card gradient | `linear-gradient(135deg,#EAF1FB 0%,#F4F0FB 52%,#FBF1E4 100%)` | Sky wash |
| Chip / now-cell white | `rgba(255,255,255,0.7–0.95)` | Frosted highlights |

### Condition colors (`WX_COLOR`)

| Condition | Color |
|---|---|
| `sun` | `#D89B3A` |
| `partly` | `#D89B3A` |
| `cloud` | `#8A93A3` |
| `rain` | `#5B8DE0` |

### Typography

| Use | Family | Weight | Size | Notes |
|---|---|---|---|---|
| Temp (big) | Instrument Serif | 400 | 34 | line-height 1, letter-spacing -0.5 |
| Condition label | Inter | 600 | 13 | |
| Meta row | Inter | 400 | 12 | nowrap |
| Hourly time | Inter | 600 | 11 | |
| Hourly temp | Inter | 600 | 13 | tabular-nums |
| AI note | Inter | 500 | 12 | |

Fonts: **Inter** (400/500/600/700/800) and **Instrument Serif** (roman + italic). If the app self-hosts fonts, add these to that pipeline.

### Radii & spacing

- Radii: `13px` (hourly cell) · `14px` (icon chip) · `20px` (card).
- Internal padding: conditions row `14px 16px` · hourly strip `0 12px 12px` · AI note `10px 16px`.
- Icon chip `46×46`, glyphs `28px` (big) / `18px` (hourly) / `13px` (sparkle), chevron `18px`.
- Expand animation: `.28s ease`; chevron rotation `.25s ease`.

---

## Assets

All icons are **inline SVG**, no asset files:
- **Weather glyphs** (`sun`, `partly`, `cloud`, `rain`) — custom line-style, 24px viewBox, in `weather-widget.jsx` → `WX`. On native, you may swap for SF Symbols / Material symbols to match platform, but the custom set is tuned to Housemait's icon weight (1.7px stroke).
- **Chevron** — inline, in the conditions row.
- **Sparkle** — the app's AI accent icon, inlined here as `SparkleIcon`. Use your app's existing AI/sparkle icon if it has one.

No raster images, no brand wordmark on this widget.

---

## Files

- **`preview.html`** — open in a browser to see the widget live (collapsed by default; click to expand, swipe the hourly row).
- **`weather-widget.jsx`** — the `WeatherStrip` component, self-contained (sparkle icon inlined). The component to recreate in your framework.

### Where it lives in the prototype
In the full app it's defined in `src/screens-home.jsx` as `WeatherStrip`, rendered just above the `AIComposer` in both `HomeDashboard` and `HomeAIFirst`.

---

## Implementation checklist

- [ ] Component renders collapsed by default
- [ ] Whole conditions row is one tap target; toggles expand
- [ ] Chevron rotates 180° on expand
- [ ] Height animates smoothly (~280ms) — platform-appropriate technique
- [ ] Hourly strip scrolls horizontally with momentum + snap; scrollbar hidden
- [ ] 24 hour-cells, "Now" first and highlighted
- [ ] Hourly temps use tabular figures so columns align
- [ ] `padding-left ≥ 12px` on the strip so "Now" highlight isn't flush to edge
- [ ] Condition codes from the API mapped to `sun|partly|cloud|rain` (+ colors)
- [ ] Real location + units honored
- [ ] AI note generated server-side; row hidden if absent
- [ ] AI note taps through to the AI composer
- [ ] Fonts loaded (Inter + Instrument Serif)
- [ ] Tokens added to your design-system
- [ ] Accessibility: `aria-expanded`, labels on both buttons, decorative glyphs hidden
- [ ] Placed above the composer in both home variations
