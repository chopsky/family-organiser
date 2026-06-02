# Handoff: Housemait Sign-in (Concept 02 · Concierge)

## Overview

The sign-in page for **Housemait**, the household-coordination web app. This is the page a returning user lands on at `/login` (or equivalent) to authenticate before entering the dashboard. The design is intentionally quiet and minimal - a single centered glass card on a soft ambient cream background - so the moment of "coming home" to the product feels calm rather than transactional.

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** - prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **recreate this design in your target codebase's existing environment** (React, Vue, SvelteKit, Next.js, Remix, etc.) using its established patterns, component library, and styling solution (Tailwind / CSS Modules / styled-components / Linaria / whatever ships there).

If the target codebase has no UI conventions yet, choose the most appropriate framework for the project and implement the design there. **Do not ship the JSX in this bundle verbatim** - it uses inline-style objects and global `var(--*)` tokens that won't fit a real codebase. Lift the visual values (hex codes, sizes, radii, shadows) from this document and the source files, not the styling approach.

## Fidelity

**High-fidelity (hifi).** Colors, typography, spacing, and the auth-button composition are final. Implement pixel-perfectly using your codebase's existing libraries - but do reach for your real OAuth/auth components instead of the prototype buttons.

---

## Screen: Sign in

### Purpose

A returning user signs into their household account via Google OAuth, Apple OAuth, or an email magic link. New users tap "Create an account" to enter the sign-up flow.

### Layout

Full-viewport stage, single-screen, no scroll. Composition:

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   (soft purple radial top-fade, coral blob bottom-left,   │
│    purple blob top-right - all heavily blurred)           │
│                                                           │
│                  ┌──────────────────────┐                 │
│                  │   [house glyph chip] │                 │
│                  │                      │                 │
│                  │   Welcome  home.     │  ← glass card   │
│                  │   Mia & 2 others …   │                 │
│                  │                      │                 │
│                  │   [Continue w Google]│                 │
│                  │   [Continue w Apple] │                 │
│                  │   ── OR ──           │                 │
│                  │   [email  →]         │                 │
│                  │                      │                 │
│                  │   New to Housemait?  │                 │
│                  │   Create an account →│                 │
│                  │   By continuing …    │                 │
│                  └──────────────────────┘                 │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

- **Stage**: 100vw × 100vh, `overflow: hidden`, centered card (flex centered on both axes).
- **Card width**: fixed `420px` on desktop. On viewports < 480px, card becomes `width: 100%` with `margin: 24px` gutter and the inset padding shrinks to `28px 22px 22px`.
- **Card padding**: `40px 36px 32px` (desktop).
- **Vertical position**: visually centered. On very short viewports (< 600px tall), justify-start with `top: 48px` and the card scrolls.

### Background

Layered, all in one container:

1. **Base radial fade** - `radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)`
2. **Coral blob** (bottom-left)
   - Size: `760×760`, `border-radius: 50%`
   - Position: `left: -180px; bottom: -300px`
   - Fill: `radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)`
   - Filter: `blur(20px)`
3. **Purple blob** (top-right)
   - Size: `600×600`, `border-radius: 50%`
   - Position: `right: -160px; top: -200px`
   - Fill: `radial-gradient(circle, rgba(108,61,217,0.18) 0%, rgba(108,61,217,0) 70%)`
   - Filter: `blur(20px)`

Both blobs are decorative; mark them `aria-hidden`.

### Components

#### Glass card (the sign-in panel)

| Property | Value |
|---|---|
| Width | `420px` |
| Padding | `40px 36px 32px` |
| Background | `rgba(255,253,250,0.86)` |
| Backdrop filter | `blur(18px) saturate(140%)` (with `-webkit-` prefix) |
| Border | `1px solid rgba(255,255,255,0.9)` |
| Border radius | `24px` |
| Box shadow | `0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)` |

#### House-glyph chip (top of card)

A 60×60 rounded square that holds the brand house glyph. Centered, with `margin-bottom: 18px`.

| Property | Value |
|---|---|
| Size | `60 × 60` |
| Border radius | `18px` |
| Background | `#EFE9FB` (`--brand-soft`) |
| Border | `1px solid rgba(108,61,217,0.18)` |
| Glyph | House SVG (see *Assets*), 32px, color `#6C3DD9` |

#### Headline

> **Welcome _home._**

- Element: `h2`
- Font: **Instrument Serif**, weight 400, size **40px**, line-height **1.05**, letter-spacing **-0.02em**
- Color: `#1A1620` (`--ink`)
- The word "home." uses **Instrument Serif Italic** colored `#6C3DD9` (`--brand`). Trailing period is part of the italic span.
- Alignment: center.

#### Sub-copy

> Mia & 2 others are signed in. Join them.

- Font: Inter 400, **13px**, line-height **1.5**, color `#4A4453` (`--ink-2`)
- Margin: `10px 0 24px`, alignment: center.
- This copy is **dynamic** - see *State Management* below. Fallback if unknown: hide the line entirely.

#### Auth buttons (3 controls, stacked, gap `10px`)

All three controls are full-width, font Inter 600 / 14px.

**1. Continue with Google** (primary)

| Property | Value |
|---|---|
| Padding | `14px 18px` |
| Border radius | `12px` |
| Background | `#6C3DD9` (`--brand`) |
| Text color | `#FFFFFF` |
| Icon | Multi-colored Google "G" (18px) at left; text gap 10px |
| Border | `1px solid transparent` |
| Box shadow | `0 6px 16px -8px rgba(108,61,217,0.45)` |

**2. Continue with Apple** (secondary / ghost)

| Property | Value |
|---|---|
| Padding | `14px 18px` |
| Border radius | `12px` |
| Background | `#FFFFFF` |
| Text color | `#1A1620` (`--ink`) |
| Icon | Apple wordmark glyph (18px) at left, color `--ink` |
| Border | `1px solid rgba(26,22,32,0.10)` |
| Box shadow | `0 1px 0 rgba(26,22,32,0.04)` |

**3. "OR" divider**

A row with two thin rules and a centered uppercase label.

- Two `flex: 1; height: 1px;` rules, color `rgba(26,22,32,0.12)` (`--line-strong`)
- Label "OR", 11px, letter-spacing 0.08em, color `--ink-3` (`#8A8493`)
- Vertical margin: `4px 0`

**4. Email magic-link row** (combined input + send button)

| Property | Value |
|---|---|
| Container padding | `12px 14px` |
| Container border radius | `12px` |
| Container background | `#FFFFFF` |
| Container border | `1px solid rgba(26,22,32,0.10)` |
| Input | borderless transparent, `14px` Inter 400, placeholder color `--ink-3` |
| Mail icon | 18px, color `--ink-3`, sits left of input |
| Send button | `padding: 8px 14px`, `border-radius: 8px`, bg `--ink` (`#1A1620`), color `#fff`, weight 600, label "→" |

#### Create-account link

> New to Housemait? **Create an account →**

- Container: centered, `margin-top: 20px`, font Inter 400 / 13px, color `--ink-2`
- Link: Inter 700, color `#4A22A8` (`--brand-deep`), `text-decoration: none`, `border-bottom: 1.5px solid #4A22A8`, `padding-bottom: 1px`
- Arrow `→` is part of the link label.

#### Terms line

> By continuing, you agree to our **Terms**.

- Centered, `margin-top: 14px`, Inter 400 / 12px, color `--ink-3`
- "Terms" link: same font, color `--ink-2`, no underline. Clicking opens the live Terms page in a new tab.

### Hover / focus / active states

These were not explicitly mocked - apply your codebase's standard auth-button states. Recommendations:

- **Buttons (all)**: scale `0.99` on `:active`, `transform: translateY(-1px)` on `:hover`, transition `transform .15s ease, box-shadow .15s ease`. Increase shadow ~15% on hover.
- **Google button**: hover bg → `#5A30C2` (≈90% lightness of brand).
- **Apple / email-container**: hover border → `rgba(26,22,32,0.18)`, bg unchanged.
- **Focus**: visible focus ring per your design system. Suggested: `outline: 2px solid #6C3DD9; outline-offset: 2px;` for keyboard focus.
- **Create-account link**: hover → drop the border-bottom and add `text-decoration: underline; text-underline-offset: 3px;`.

### Loading & error states

Per your codebase conventions. Suggested behavior:

- **OAuth click**: replace button label with a centered spinner + "Signing in…", disable all three controls.
- **Email submit**:
  - On valid email submit, swap the row's content to "Check your inbox - link sent to *email*" with a small success check.
  - On invalid email, surface inline error in red below the row: "That doesn't look like a valid email."
- **OAuth failure**: toast/banner above the card, "Couldn't sign you in - try again."

### Responsive behavior

- ≥ `481px` wide: as described above, card 420px centered.
- < `481px` wide: card becomes `calc(100vw - 32px)` with `padding: 28px 22px 22px`. Headline drops to `34px`. Buttons unchanged (already mobile-friendly).
- < `600px` tall: change page from flex-center to flex-start with `padding-top: 48px` so the card doesn't get clipped on landscape phones.

The blobs and radial fade remain unchanged at all sizes - they fill the viewport.

---

## State Management

The whole page is essentially stateless from the form's perspective - auth is offloaded to OAuth/magic-link flows. Suggested state:

```ts
type SignInState = {
  email: string;                     // controlled input value
  status: 'idle' | 'oauth-google' | 'oauth-apple' | 'magic-sending' | 'magic-sent' | 'error';
  error?: string;
  knownHousehold?: {                 // for sub-copy personalization
    primaryMember: string;           // "Mia"
    otherCount: number;              // 2
  };
};
```

### Personalized sub-copy ("Mia & 2 others are signed in.")

Read from a `?household=<slug>` query param (or a cookie set during sign-up) and call a public endpoint like `GET /api/households/:slug/preview` that returns `{ primaryMember, otherCount }`. If no slug or the call fails, **omit the sub-copy line entirely** - do not show a placeholder like "Sign in to your account".

### Data fetching

Only the household-preview call above. No other prefetch - all real data loads post-auth on the dashboard.

---

## Design Tokens

### Colors

| Token | Hex | Use |
|---|---|---|
| `--bg-app` | `#FAF7F2` | App cream (rarely visible behind blobs) |
| `--bg-app-soft` | `#F3EEE5` | Radial fade bottom |
| `--ink` | `#1A1620` | Headings, body text, send-button bg |
| `--ink-2` | `#4A4453` | Body copy, secondary labels |
| `--ink-3` | `#8A8493` | Tertiary / placeholder / legal |
| `--line` | `rgba(26,22,32,0.07)` | Faint hairlines |
| `--line-strong` | `rgba(26,22,32,0.12)` | Visible borders, divider rules |
| `--brand` | `#6C3DD9` | Primary CTA, italic accent, glyph |
| `--brand-soft` | `#EFE9FB` | Glyph-chip background, top of radial fade |
| `--brand-deep` | `#4A22A8` | "Create an account" link |
| (warm blob) | `rgba(232,180,160,*)` | Coral ambient blob |

### Spacing scale (px)

Card-internal: `8 · 10 · 14 · 18 · 20 · 24 · 32 · 36 · 40`.
The card sits in viewport-centered flow - no surrounding margin needed.

### Typography scale

| Use | Family | Weight | Size | Line height | Letter spacing |
|---|---|---|---|---|---|
| Headline | Instrument Serif | 400 | 40 | 1.05 | -0.02em |
| Headline accent | Instrument Serif Italic | 400 | 40 | 1.05 | -0.02em (color `--brand`) |
| Sub-copy | Inter | 400 | 13 | 1.5 | normal |
| Button label | Inter | 600 | 14 | 1.45 | normal |
| OR divider | Inter | 400 | 11 | 1 | 0.08em |
| Create-account link | Inter | 700 | 13 | 1.45 | normal |
| Terms line | Inter | 400 | 12 | 1.45 | normal |

Load both families from Google Fonts:

```
Inter: weights 400, 500, 600, 700, 800
Instrument Serif: roman + italic
```

### Radius scale (px)

`8` (send btn) · `12` (auth buttons, email row) · `18` (glyph chip) · `24` (card).

### Shadows

- Card: `0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)`
- Google btn: `0 6px 16px -8px rgba(108,61,217,0.45)`
- Apple btn: `0 1px 0 rgba(26,22,32,0.04)`

---

## Assets

### House glyph (used in the card chip)

An original outline-style house with an "H"-shape inside. Inline SVG, no asset file needed. From `login-shared.jsx` → `HouseGlyph`:

```jsx
<svg width="32" height="32" viewBox="0 0 48 48" fill="none">
  <path d="M6 22 L24 6 L42 22 L42 40 Q42 42 40 42 L8 42 Q6 42 6 40 Z"
        stroke="#6C3DD9" stroke-width="3" stroke-linejoin="round" fill="none"/>
  <path d="M17 42 V26 H31 V42"
        stroke="#6C3DD9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M17 33 H31" stroke="#6C3DD9" stroke-width="3" stroke-linecap="round"/>
  <circle cx="24" cy="18" r="1.6" fill="#6C3DD9"/>
</svg>
```

The full Housemait wordmark (PNG) is **not** used on this screen - only the glyph. If your codebase has the canonical brand SVG glyph already, use that instead.

### Google "G", Apple, and Mail icons

All inline SVGs, see `login-shared.jsx` → `GoogleG`, `AppleIcon`, `MailIcon`. Replace with your codebase's icon set if it already has them.

### Fonts

Google Fonts - Inter and Instrument Serif. If the codebase self-hosts fonts, add these to that pipeline.

---

## Files

In this bundle:

- **`preview.html`** - Open in a browser to see the design rendered. Pure reference; not for production.
- **`login-concierge.jsx`** - The screen composition. The component to recreate in your framework.
- **`login-shared.jsx`** - Shared primitives: `HouseGlyph`, `GoogleG`, `AppleIcon`, `MailIcon`, `AuthButtons`. Same caveat - recreate the equivalents in your codebase rather than copying these verbatim.

---

## Implementation checklist

- [ ] Page route mounted (`/login` or equivalent)
- [ ] Fonts loaded (Inter + Instrument Serif)
- [ ] Color tokens added to your design-system tokens file
- [ ] Card laid out with backdrop-filter blur (verify Safari/iOS support - has `-webkit-` prefix in the CSS)
- [ ] Three ambient layers (radial fade + two blobs) rendered, `aria-hidden`
- [ ] Google OAuth wired to your existing provider
- [ ] Apple OAuth wired (if supported)
- [ ] Email magic-link endpoint wired with idle / sending / sent states
- [ ] "Create an account" link routed to sign-up
- [ ] Sub-copy hidden when household preview API returns nothing
- [ ] Mobile breakpoint (< 481px) sized correctly
- [ ] Keyboard focus order: Google → Apple → email input → send → create-account → Terms
- [ ] Accessible: blobs `aria-hidden`, all icons have `aria-hidden` or `aria-label`, "Send magic link" button has `aria-label="Send magic link"` rather than just `→`
