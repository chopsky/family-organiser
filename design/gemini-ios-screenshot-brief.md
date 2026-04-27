# Housemait — iOS Screenshot Design Brief

> Paste this entire document into Gemini, then attach 2–3 reference screenshots
> from `housemait.com` (hero, features, pricing) so it has a visual anchor.
> Gemini will match the aesthetic far more reliably from images + this spec
> than from words alone.

## What you're designing

A set of **App Store screenshots** for the Housemait iOS app — UK family-organiser app. Each screenshot is a marketing image: a phone frame with our app UI inside, plus a short headline + subhead above the phone explaining the screen. Backdrop is our brand cream (`#F8F1E8`).

**Canvas size:** 1290 × 2796 px (iPhone 15 Pro Max App Store spec).
**Phone frame inside:** iPhone 15 Pro, 393 × 852 device pixels, rendered at ~2× for crispness. Status bar shows **9:41 · 100% battery**. Use a **Dynamic Island** (not the older notch).

## Brand pillars

- **Warm but not twee.** Not corporate, not cutesy.
- **Organised but not rigid.** Quietly capable, never severe.
- **Modern but not cold.** Soft edges, warm shadows, restraint.
- **Tone:** dry-British, understated. Never American-bright. Never "🚀 Crush your week!"
- **Audience:** UK households with kids (parents, mostly). They are tired and want calm, not productivity-bro energy.

## Colour palette — exact hex values

### Primary

| Name         | Hex       | Use                                                  |
| ------------ | --------- | ---------------------------------------------------- |
| Plum         | `#6B2FB8` | CTAs, primary actions, italic accents in headings    |
| Plum deep    | `#4A1D82` | Hover/pressed states                                 |
| Plum soft    | `#EADCFB` | Active nav backgrounds, decorative blobs             |
| Coral        | `#E8795A` | Notifications, badges, urgency                       |
| Coral soft   | `#FADDD0` | Notification bubbles                                 |
| Sage         | `#8FB089` | Success, completion, meals/health                    |
| Sage soft    | `#DCE8D5` | Success backgrounds, "Ready" pills                   |
| Butter       | `#F3C775` | Highlight accents, ★ ratings                         |
| Butter soft  | `#FBE9C7` | Meal-card backgrounds                                |

### Neutrals

| Name         | Hex       | Use                                                  |
| ------------ | --------- | ---------------------------------------------------- |
| Cream        | `#F8F1E8` | Page background — **never use pure #FFF as canvas**  |
| Cream deep   | `#F1E6D3` | Subtle section dividers                              |
| White        | `#FFFFFF` | Card surfaces, app screen background                 |
| Ink          | `#1B1424` | Primary text                                         |
| Ink soft     | `#52485C` | Secondary text, captions, meta                       |

## Typography — **non-negotiable**

- **Display headings (the marketing copy above each phone):** **Instrument Serif**, weight 400, italic permitted on accent words. Letter-spacing `-0.015em`. Sizes: hero 64–88 px, section heading 48–60 px, in-app screen titles 22–28 px.
- **Italic accent in display headings** is the signature move. Pick 1–2 words and italicise them in **Plum (`#6B2FB8`)**. Example: "Family life *intelligently organised.*"
- **UI / body / labels:** **Inter** at weights 400/500/600/700. Used for buttons, list items, captions, body copy.
- **DO NOT use SF Pro, SF Display, or any system iOS font.** Instrument Serif over Inter is the brand fingerprint — losing either breaks the look.
- **Eyebrow labels** (small caps above headings): Inter 12 px, weight 600, letter-spacing `0.18em`, uppercase, colour `#6B2FB8`.

## Spacing & shape

- **Base unit:** 8 px. Common values: 4, 8, 12, 16, 24, 32, 48, 64.
- **Corner radii:**
  - Cards / containers: `16px`
  - Buttons: `12px` (or `999px` pill for marketing CTAs and chips)
  - Inputs: `10px`
  - Chips / badges: `8px`
  - Avatars: `50%` (fully round)
- **Shadows — warm-toned, never cool grey:**
  - Soft: `0 1px 2px rgba(27, 20, 36, .05), 0 2px 8px rgba(27, 20, 36, .04)`
  - Medium: `0 10px 30px -12px rgba(74, 29, 130, .18), 0 4px 12px rgba(27, 20, 36, .06)`
  - Large: `0 30px 80px -20px rgba(74, 29, 130, .35)`
- **Decorative backdrop trick:** Behind a phone or card, place a soft tinted blob (Plum-soft, Coral-soft, Sage-soft, or Butter-soft) rotated `-2deg` with `36px` border-radius and `inset: -24px`. This adds warmth without competing with the content.

## In-app component recipes

The phone-frame interior should look like this:

- **App background:** Cream (`#F8F1E8`).
- **Card surface:** White, 16 px radius, soft shadow, 16–20 px internal padding.
- **List rows:** White card containing rows separated by `1px solid rgba(27,20,36,.05)`. Each row: 12 px vertical padding, left avatar (24 px round), title (Inter 500 14 px Ink), meta (Inter 500 12 px Ink-soft).
- **Avatars:** Round, vibrant single-colour background (use Plum, Coral, Sage, Butter, Sky `#A9C1E8`, or Pink `#F4C4C2`), white initial (Inter 700 12–14 px), 2 px white inner-border ring.
- **Primary button:** Plum background, white text, Inter 600 14 px, `12px` radius, `48px` tall. Subtle plum drop shadow.
- **Secondary button:** White background, 1.5 px Plum border, Plum text.
- **Chip / pill:** White, `999px` radius, 1.5 px Light-grey border (`#E8E5EC`), Inter 600 13 px Ink-soft, optional small coloured dot or stroke icon on the left.
- **Status / category dot:** 6–8 px round, in Plum / Coral / Sage / Butter, often with a soft glow (`box-shadow: 0 0 0 4px rgba(<colour>, .25)`).
- **Bottom tab bar:** Frosted glass (`background: rgba(255,255,255,0.92), backdrop-filter: blur(20px)`), 82 px tall, 1 px top border in Light-grey. Active tab icon **filled** in Plum, label in Plum 11 px 600. Inactive tabs: stroke icon, Ink-soft.
- **iOS safe-area:** Leave the top 59 px clear for status bar / Dynamic Island. Bottom 34 px clear for the home indicator.

## Marketing layout (around the phone)

Each screenshot follows the same structure:

1. **Top third:** Headline in Instrument Serif (50–64 px) + 1-line subhead in Inter 18–20 px Ink-soft. Headline can be 2 lines, with 1 italic accent word in Plum.
2. **Middle:** The phone frame, slightly tilted (-2° to -5°) on a soft tinted blob (see "decorative backdrop trick" above).
3. **Optional floating sticker:** A tiny white card pinned to one corner of the phone, like a notification — 13 px Inter 500, with a small coloured icon-square on the left. E.g. "Beef sausages — added to shopping list".
4. **Bottom:** Negative space, no logo at the bottom (the App Store frame already brands it).

## Voice — copy that goes on the screenshots

Examples from the live site (use these as a calibration set):

- "The quiet hum of family life made easy with AI."
- "Family life intelligently organised."
- "Every date, every body, on one page."
- "The mental load, finally split fairly."
- "Less than a takeaway a month."

Notes on voice:
- 3–7 word headlines. Cadence matters more than information density.
- One italic accent word per headline lands. Two competes.
- Avoid emoji in marketing headlines (they're fine inside the phone UI as content).
- No exclamation marks. We don't shout.

## Things to AVOID

- **Pure white backgrounds.** Always cream as canvas.
- **SF Pro / SF Display anywhere.** Use Instrument Serif + Inter only.
- **Cool grey shadows.** Warm shadows tinted with Plum or Ink only.
- **Generic SaaS purple** (`#7B2CBF`, `#8B5CF6`, etc.). The Plum is `#6B2FB8` — slightly bluer than typical "tech purple".
- **Twee illustration** — no flat-design family blobs, no juggling parents.
- **Productivity-bro language** — "Crush your week", "10× your household", "Unlock peak family", etc.
- **Cluttered phones.** Less is more. Two cards on screen beats five.
- **American conventions.** No "moms", "soccer", "vacation". Use "mums", "football", "holiday".
- **Tilted phones at extreme angles** (>-7°). Keep it subtle.
- **Glow effects, gradients on text, neon.** The brand is calm.

## What "good" looks like — checklist

Before exporting, verify each screenshot has:

- [ ] Cream `#F8F1E8` canvas
- [ ] Headline in Instrument Serif with 1 italic Plum accent word
- [ ] Subhead in Inter 18–20 px Ink-soft
- [ ] Phone tilted -2° to -5° on a soft tinted backdrop blob
- [ ] White-card UI inside the phone, 16 px radius, warm shadow
- [ ] Round avatars in vibrant single-colour backgrounds
- [ ] Status bar showing 9:41
- [ ] No SF Pro anywhere
- [ ] No emoji in the marketing headline
- [ ] Calm, breathable composition — never cluttered

## File hand-off

Export each screenshot as **PNG, 1290 × 2796 px**, `@1x` (Apple's spec). Name them `01-calendar.png`, `02-tasks.png`, etc. so the order in the App Store listing is obvious.
