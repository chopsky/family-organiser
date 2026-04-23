# Handoff: Housemait iOS App Redesign

## Overview
This package documents an iOS redesign of the Housemait family-coordination app. It covers the full bottom-tab structure (Home, Calendar, Tasks, Shopping, More) plus every surface reached from those tabs: a full-week Meal Plan with Recipe Box, Documents, Family, Receipts, Settings, an AI assistant overlay, and several modal sheets. Two alternative Home layouts are included — a dashboard (A) and an AI-first variant (B) — exposed via a Tweaks panel for side-by-side comparison.

## About the Design Files
The files in `designs/` are **design references created in HTML** — React-in-Babel prototypes showing intended look, copy, and behavior. They are **not production code to copy directly**. The task is to **recreate these designs in the existing Housemait iOS codebase** using its established patterns (SwiftUI / UIKit / whatever the app uses), its typography system, its design tokens, and its networking layer. If multiple paths exist, prefer the one that matches the rest of the app.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, interactions, and copy are all final. The developer should recreate the UI pixel-perfectly using native iOS primitives and the app's existing component library. Motion (sheet presentation, check animations) and state transitions are specified below.

## Screens / Views

### 1. Home — Variant A: Dashboard (`HomeDashboard`, `src/screens-home.jsx`)
Primary layout. Scrollable column, 20 px horizontal padding, 18 px between sections, 70 px top / 130 px bottom inset to clear the status bar and tab bar.

**Header** — `housemait` wordmark on the left (22 px tall); bell button + user avatar (36 px circle) on the right. Tapping the avatar pushes the Settings screen.

**Greeting** — Instrument Serif italic, 36 px, `"Good morning,"` on one line and the user's first name (italic) on the next. Metadata below in 13 px Inter 500: `{long date} · {N} events, {M} tasks`.

**AI composer** — Rounded 18 px card, white, faint border. Leading sparkle icon, placeholder `"Ask, plan, or scan…"`, trailing mic. Tap anywhere → opens the full-screen AI sheet.

**Up Next hero card** — Dark card (`--ink`), rounded 22 px, full-bleed gradient overlay. `NEXT UP` kicker (white 60 %) + event title (Instrument Serif 28 px white) + time + location + driver badge.

**Today's schedule** — Section title "Today". Vertical timeline with left-aligned time labels and colored event cards.

**Tasks & Groceries** — Two full-width stacked cards (previously 2×2, changed to avoid cramping). Each shows category pill, assignee avatar, due date, and a circular checkbox that animates fill on toggle.

**Week's meals** — 7-day pill strip, Sat highlighted dark.

**Family** — Avatar stack + 2-line caption.

### 2. Home — Variant B: AI-first (`HomeAIFirst`)
Same shell but the top half is editorial: 44 px Instrument Serif headline ("What can I handle for you?"), composer, AI suggestion chips in serif italic, dark "Next up" hero, then a 2×2 stat tile grid (open tasks / to buy / events / meals planned).

### 3. Calendar (`CalendarScreen`)
- Kicker `APRIL 2026` + serif large title
- Mini month grid (6 rows × 7 cols), selected day filled with `--brand`, days with events dotted
- Below grid: selected day's events in a vertical list

### 4. Tasks (`TasksScreen`)
- Kicker `6 OPEN · 1 DONE` + serif large title
- Filter pills: **All · Mine · Home · Pets · Kids** (active = ink fill)
- Open tasks list, each row: circular checkbox, title, category pill, due date, assignee avatar
- "Recently done" section collapsed with strike-through
- Purple FAB bottom-right opens Add Task sheet

### 5. Shopping (`ShoppingScreen`)
- Kicker `12 ITEMS · 3 LISTS` + serif large title
- Horizontally-scrolling list pills (Home, Tesco, Sainsbury's, Aldi, Waitrose, M&S) with count badges — **no emoji icons**
- AI suggestion chip strip below
- Items grouped by category (Dairy, Veg, Pantry, Frozen)
- "In trolley" (done) section at the bottom

### 6. Meal Plan (`MealPlanScreen`) — rebuilt to match desktop
**Tab toggle:** Meal Plan / Recipe Box (segmented control, white-on-ink-soft background, 4 px inner padding).

**Meal Plan tab:**
- Kicker `WEEK OF 13 APR 2026` + serif title
- Week navigator card: prev chevron · "13 – 19 April" · next chevron
- 7 day cards. Today (Sat 18) highlighted with `--ink` fill. Each card header = weekday abbrev + large serif date + right-aligned `N/4 meals planned`
- Body = **2×2 grid of meal slots**: Breakfast (amber), Lunch (green), Dinner (blue), Snack (pink). Filled slot = soft-tinted background + meal name. Empty slot = dashed border + `+` glyph, tap-to-plan
- Bottom actions: "Recipe Box" + "Add to shopping"

**Recipe Box tab:**
- Search field
- Horizontal scrollable filter chips: All · Favourites · Breakfast · Lunch · Dinner · Snack
- Count + "Add recipe" link
- Recipe cards (full list in `data.jsx` `RECIPES`): 44 px colored thumbnail, name, category pill, `N min`, `serves N`, heart toggle (filled pink when favourited)

### 7. More sheet (`MoreSheet`, `src/screens-more.jsx`)
Opens from the 5th tab. 2×2 grid of destination tiles (Meal Plan, Receipts, Documents, Family) + Account list (Settings · Notifications · Connected apps · Privacy & data · Help & support) — **Settings is the first row, bolded**.

### 8. Documents (`DocumentsScreen`)
Storage bar, Upload + New folder actions, horizontally-scrolling folder cards (School, Medical, Insurance, Pets, Warranties, Tax), recent files list.

### 9. Family (`FamilyScreen`)
Dark gradient cover, household name + avatar stack, member rows with edit affordance, settings section (reminder time, timezone, billing).

### 10. Receipts (`ReceiptsScreen`)
Large scanner drop-zone, "this month" card with inline bar chart, recent receipts list with AI match counts.

### 11. Settings (`SettingsScreen`, `src/screens-settings.jsx`)
iOS-style grouped list. Profile row (avatar + edit) + Family plan row. Sections: Preferences (notifications, daily reminder toggle, reminder time, language, units), Appearance (theme, match system, accent colour), AI (suggestions, voice), Privacy & data (biometric lock, analytics, export, delete), Connected (WhatsApp, Apple Cal, Google Cal), Support (help centre, contact, rate). Version stamp at the bottom.

### 12. AI sheet (`AISheet`, `src/sheets.jsx`)
Full-screen sheet with 32 px Instrument Serif greeting, 4 quick-prompt cards (add event / add grocery / plan meal / create task — each with sample italic copy in quotes), composer at the bottom, attachment chips. On submit, becomes a conversational thread with keyword-tuned canned AI replies (recital → calendar, milk → grocery list, etc.).

### 13. Add sheet (`AddSheet`)
Title input (serif 28 px), Assign-to avatar pills, Category chips, AI tip strip, Save button (disabled until title non-empty).

## Interactions & Behavior

- **Tab persistence:** `localStorage['hm-tab']` — survives reload.
- **Home variant persistence:** `localStorage['housemait-ios-tweaks']` JSON — drives `home: dashboard | ai`, `theme`, `accent`, `density`.
- **Task/grocery check:** Toggle animates a fill from centre, strikes text after 200 ms.
- **AI FAB:** Floats above the tab bar at the right (not inside the tab bar). Opens AI sheet.
- **Sheet presentation:** Backdrop fades in over 250 ms; panel slides up with `cubic-bezier(0.32, 0.72, 0, 1)` over 320 ms. Tap backdrop or drag handle to dismiss.
- **Avatar tap (Home, either variant):** Pushes Settings.
- **More → Settings:** Also pushes Settings.

## State Management

- `tab: 'home' | 'cal' | 'tasks' | 'shop' | 'meal' | 'docs' | 'family' | 'receipt' | 'settings'`
- `tasks: Task[]` — `{ id, title, who, cat, done, due }`
- `groceries: Grocery[]` — `{ id, name, qty, cat, done, list }`
- `meals: DayMeals[]` — `{ day, date, breakfast, lunch, dinner, snack }` (null = empty slot)
- `recipes: Recipe[]` — `{ id, name, cat, mins, serves, fav }`
- Modal flags: `aiOpen`, `addOpen`, `moreOpen`
- Tweaks: `home`, `theme`, `accent`, `density`

## Design Tokens

Defined in `Housemait iOS.html` `:root`:

**Surfaces**
- `--bg-page: #ECE7DD`
- `--bg-app: #FAF7F2`
- `--bg-app-soft: #F3EEE5`

**Ink**
- `--ink: #1A1620`
- `--ink-2: #4A4453`
- `--ink-3: #8A8493`
- `--line: rgba(26,22,32,0.07)`
- `--line-strong: rgba(26,22,32,0.12)`

**Brand (from logo)**
- `--brand: #6C3DD9`
- `--brand-soft: #EFE9FB`
- `--brand-deep: #4A22A8`

**Category accents** (paired soft backgrounds)
- Warm `#E8B4A0` / `#FBEFE8`
- Green `#6BA368` / `#E5F0E2`
- Amber `#D89B3A` / `#FBF1DE`
- Pink  `#D8788A` / `#FBE6EA`
- Blue  `#5B8DE0` / `#E2ECFA`

**Typography**
- UI: **Inter** 400/500/600/700/800
- Display: **Instrument Serif** (regular + italic). Used for greetings, large titles, day numbers, editorial headlines.
- Large title: 36 px serif, letter-spacing −0.8
- Section title: 22 px Inter 700, letter-spacing −0.4
- Body: 14 px Inter 400/500
- Meta / kicker: 11 px Inter 700, 0.1 em tracking, uppercase, `--ink-3` or `--brand`

**Radii:** card 18, hero 22, field 12, pill 99

**Shadows:** card `0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)`; sheet `0 −10px 30px rgba(0,0,0,0.12)`; FAB `0 4px 12px rgba(108,61,217,0.35)`

**Spacing:** 4 / 8 / 12 / 16 / 20 / 24 base.

## Assets
- `assets/housemait-logo.png` — official wordmark (house-people glyph + `housemait` sans-serif), 1000×162 PNG with transparency. The only shipped brand asset; the app should use its vector / Asset-Catalog equivalent at native sizes.
- All icons are hand-drawn SVG paths (see `src/icons.jsx`). The target codebase should replace them with SF Symbols or its existing icon set (bell, calendar, check, cart, fork, sparkle, plus, close, chevrons, etc.).

## Files (in this handoff)
- `designs/Housemait iOS.html` — root HTML with tokens, tweaks panel, and script includes
- `designs/src/app.jsx` — root React component, tab routing, state
- `designs/src/data.jsx` — all sample data (family, tasks, groceries, meals, recipes, schedule, docs, receipts)
- `designs/src/ui.jsx` — shared primitives (Avatar, Card, Chip, Checkbox, TabBar, AIComposer, Brandmark, ScreenTopBar, SectionTitle, status bar)
- `designs/src/icons.jsx` — SVG icon set
- `designs/src/screens-home.jsx` — HomeDashboard + HomeAIFirst
- `designs/src/screens-other.jsx` — Calendar, Tasks, Shopping, MealPlan (+ RecipeBox subcomponent)
- `designs/src/screens-more.jsx` — Documents, Family, Receipts, MoreSheet
- `designs/src/screens-settings.jsx` — Settings screen
- `designs/src/sheets.jsx` — Sheet primitive, AISheet, AddSheet
- `designs/lib/ios-frame.jsx` — iOS device bezel (not to be ported; it's just the presentation frame)
- `designs/assets/housemait-logo.png` — brand wordmark
