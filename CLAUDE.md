# Nestd — Family Organiser

## Project overview

Nestd is a family organiser app targeting modern UK families. It helps households coordinate calendars, grocery lists, meal plans, tasks, and more. The app is built with React and deployed on Vercel.

## Design system

Full brand guidelines: `/design/nestd-brand-guidelines.docx`
Target interface mockup: `/design/nestd-interface-redesign.html`

Always reference these files when making UI changes. The HTML mockup is the source of truth for layout, spacing, and component patterns.

### Brand personality

Warm but not twee. Organised but not rigid. Modern but not cold. The UI should feel like a calm, capable friend — not a corporate productivity tool. Celebrate the beautiful chaos of family life.

### Colour palette

#### Primary

| Name     | Hex       | CSS variable    | Usage                                          |
| -------- | --------- | --------------- | ---------------------------------------------- |
| Plum     | `#6B3FA0` | `--plum`        | Navigation, primary actions, headings, logo     |
| Coral    | `#E8724A` | `--coral`       | CTAs, notifications, badges, destructive actions |
| Sage     | `#7DAE82` | `--sage`        | Success, completion, meals/health, confirmations |
| Charcoal | `#2D2A33` | `--charcoal`    | Primary text                                    |

#### Supporting

| Name        | Hex       | CSS variable      | Usage                              |
| ----------- | --------- | ------------------ | ---------------------------------- |
| Plum Light  | `#F3EDFC` | `--plum-light`     | Active nav states, subtle highlights |
| Coral Light | `#FDF0EB` | `--coral-light`    | Notification backgrounds            |
| Sage Light  | `#EDF5EE` | `--sage-light`     | Success backgrounds, meal tags      |
| Warm Cream  | `#FBF8F3` | `--cream`          | Page background (never use pure #FFF) |

#### Neutrals

| Name       | Hex       | CSS variable    | Usage                          |
| ---------- | --------- | --------------- | ------------------------------ |
| Warm Grey  | `#6B6774` | `--warm-grey`   | Secondary text, meta, captions |
| Light Grey | `#E8E5EC` | `--light-grey`  | Borders, dividers              |
| White      | `#FFFFFF` | `--white`       | Card backgrounds, inputs       |

### Typography

| Role      | Font family | Weight        | Size range  | Usage                                |
| --------- | ----------- | ------------- | ----------- | ------------------------------------ |
| Display   | Lora        | 600–700       | 24–40px     | Page headings, feature titles        |
| Section   | Lora        | 500–600       | 17–24px     | Card titles, section headers         |
| Body      | DM Sans     | 400           | 15–16px     | Body text, descriptions              |
| UI Label  | DM Sans     | 500–600       | 13–14px     | Nav items, buttons, form labels      |
| Caption   | DM Sans     | 500           | 11–12px     | Timestamps, meta text, tab labels    |

Import from Google Fonts:
```
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Lora:wght@400;500;600;700&display=swap');
```

Headings use Lora with -0.02em letter-spacing. Body uses DM Sans at 1.6 line-height. Never use more than two weights per typeface in a single view.

### Spacing

Base unit: 8px. Common values: 4, 8, 12, 16, 24, 32, 48px.

| Context                  | Value |
| ------------------------ | ----- |
| Page padding (mobile)    | 20px  |
| Page padding (desktop)   | 32px  |
| Card padding (mobile)    | 14–16px |
| Card padding (desktop)   | 20px  |
| Section gap              | 48px minimum |
| Card grid gap            | 16px  |

### Corner radius

| Element            | Radius |
| ------------------ | ------ |
| Cards / containers | 16px   |
| Buttons            | 12px   |
| Input fields       | 10px   |
| Chips / badges     | 8px    |
| Avatars            | 50% (fully round) |
| Quick action pills | 24px   |

### Shadows

Use warm-toned shadows, never cool grey.

```css
--shadow-sm: 0 2px 8px rgba(107, 63, 160, 0.06);
--shadow-md: 0 4px 16px rgba(107, 63, 160, 0.08);
--shadow-lg: 0 8px 24px rgba(107, 63, 160, 0.10);
```

### Layout

#### Desktop (≥768px)

- Fixed left sidebar: 240px wide, white background, border-right 1px `--light-grey`
- Sidebar zones: top (logo + household selector), middle (nav items), bottom (user avatar + settings)
- Active nav item: `--plum-light` background pill, `--plum` text and icon
- Main content area: scrollable, max-width 720px for readability, centred
- Content grid: 2-column for dashboard cards

#### Mobile (<768px)

- No sidebar — use bottom tab bar instead
- Tab bar: 82px height, frosted glass (`background: rgba(255,255,255,0.92)`, `backdrop-filter: blur(20px)`), `border-top: 1px solid --light-grey`
- 5 tabs: Home, Calendar, Lists, Meals, Family
- Active tab: filled icon in `--plum`, label in `--plum`
- Inactive tab: stroke icon in `--warm-grey`, label in `--warm-grey`
- Notification dot: 7px circle in `--coral` with 1.5px white border, positioned top-right of icon

### Components

#### Buttons

| Variant   | Background   | Border              | Text colour | Usage                |
| --------- | ------------ | ------------------- | ----------- | -------------------- |
| Primary   | `--plum`     | none                | white       | Single main action   |
| Secondary | `--white`    | 1.5px `--plum`      | `--plum`    | Supporting actions   |
| Ghost     | transparent  | none                | `--plum`    | Tertiary / inline    |
| Danger    | `--coral`    | none                | white       | Destructive only     |

All buttons: 48px height, 12px radius, DM Sans 600 14px.

#### Cards

White background, 16px radius, `--shadow-sm`. Hover: `--shadow-md`. Card header: Lora 600 17px title + right-aligned action link in `--plum` 12px 600.

#### Form inputs

`--light-grey` border (1.5px), 10px radius, 48px height, `--cream` background. Focus: `--plum` border (2px) with subtle plum glow ring. Labels above in DM Sans 500 13px `--charcoal`.

#### Avatars

Vibrant background colour per family member (Plum, Coral, Sage, Amber `#E0A458`, Sky Blue, Orchid) with white initials. 2px white border ring. Sizes: 22px (sidebar mini), 24px (event), 32px (compact), 40px (default), 56px (profile).

#### Quick actions

Pill-shaped (24px radius), white background, 1.5px `--light-grey` border, 13px DM Sans 600. Hover: border changes to `--plum`, text changes to `--plum`. Each has a small coloured stroke icon on the left.

### Icons

Use Lucide icon set (already in the mockup). Rounded, 1.5px stroke weight. 20px for sidebar nav, 22px for tab bar, 16px for inline/buttons. Filled variants for active/selected states only.

### Motion

- Transitions: ease-out, 200–300ms
- Page transitions: horizontal slide (mobile), fade (desktop)
- Micro-interactions: spring easing for checkboxes, toggles, badge counts
- Loading: skeleton screens, never spinners
- Respect `prefers-reduced-motion`

### Navigation structure

| Section  | Icon    | Description                                              |
| -------- | ------- | -------------------------------------------------------- |
| Home     | House   | Dashboard — today's events, tasks, quick actions, feed   |
| Calendar | Calendar | Shared family calendar, week/month views, colour-coded members |
| Lists    | Checkbox | Grocery lists, to-do lists, custom lists, real-time collab |
| Meals    | Utensils | Weekly meal planner, recipe library, ingredient-to-list flow |
| Family   | Users   | Household settings, member profiles, invitations, account |

## Code conventions

- Use CSS custom properties for all design tokens (colours, shadows, radii)
- Import fonts at app level, not per-component
- Use semantic HTML elements
- Mobile-first responsive approach, desktop sidebar activates at 768px breakpoint
- All interactive elements need visible focus states
- Respect `prefers-reduced-motion` for all animations
