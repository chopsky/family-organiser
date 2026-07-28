# Twilio Content Template — evening brief

Submit this in Twilio Console → Messaging → Content Template Builder. Once
approved, set the Content SID on Railway as `TWILIO_TEMPLATE_EVENING_BRIEF` and
the WhatsApp evening brief starts sending. Until then it is skipped silently and
app users still get the push — see the guard in `src/jobs/reminders.js`.

## Why a second template is needed at all

The morning template (`housemait_morning_brief_v2`) hardcodes **"Good morning,
{{1}}! Here's your {{2}}."** in its *static* body. It has to: Twilio rejects
newlines and runs of 4+ whitespace inside variables (error 21656), which is
exactly why the greeting and the section structure live in the static body
rather than in a variable. There is no way to reword it to "tomorrow" at 8pm
through variable values, so the evening brief needs its own approved template.

## Template

| Field | Value |
|---|---|
| Friendly name | `housemait_evening_brief_v1` |
| Language | `en_GB` |
| Category | **Utility** — a scheduled notification about the recipient's own household data, same category as the morning brief |
| Content type | Text |

### Body

```
Evening, {{1}}! Here's how tomorrow's looking.

{{2}}

📅 {{3}}'s schedule:
{{4}}

📋 Reminders:
{{5}}

💡 {{6}}

Open Housemait or reply to this message to change anything.
```

**Why v1 was rejected.** The first submission numbered the variables by meaning
and then laid the body out for readability, which produced `{{1}} … {{3}} …
{{2}} …`. WhatsApp requires variables to appear in ASCENDING order in the body.
Two further defects came out of comparing it against the approved
`housemait_morning_brief_v2`:

| Defect in v1 | Why it matters |
|---|---|
| Variables ran 1, 3, 2, 4, 5, 6 | WhatsApp requires ascending order — the rejection |
| Body ended on `💡 {{6}}` | A template may not end with a variable; the approved morning one closes with a static sentence |
| Weather was prefixed `🌤️ {{3}}` | `buildDigestWeatherLine` already emits its own glyph (`🌦 19°C, wet day…`), so it rendered two |

So weather is now `{{2}}` and the weekday `{{3}}` — the reverse of the morning
template, because the evening layout puts weather above the schedule heading.
`buildDailyReminderTemplateVars` emits them in that order for the evening
variant, and there are tests pinning both shapes.

### Variables

Produced by `buildDailyReminderTemplateVars(member, { variant: 'evening', … })`.
Every one is guaranteed non-empty and single-line — the builder substitutes a
fallback phrase rather than ever emitting `""`, which would trip 21656.

| Var | Meaning | Sample for submission |
|---|---|---|
| `{{1}}` | First name | `Jade` |
| `{{2}}` | Weather one-liner (carries its own emoji) | `🌦 19°C, wet day in London (70% chance) — worth a brolly.` |
| `{{3}}` | Tomorrow's weekday | `Thursday` |
| `{{4}}` | Tomorrow's events, joined by ` · ` | `08:45 - School run (Jade) · 16:00 - Swimming (Ella)` |
| `{{5}}` | Tasks + bills due, joined by ` · ` | `Sign the trip form due tomorrow · Council tax due Friday` |
| `{{6}}` | Rotating discovery tip / help hint | `Reply /help for all commands` |

Empty-state values (also non-empty strings): `{{4}}` → `Nothing scheduled
tomorrow`, `{{5}}` → `Nothing due tomorrow`.

## Notes for the reviewer

If Meta queries the category: this is sent only to users who explicitly switched
on "Evening heads-up" in Settings → Notifications (opt-in, default off), and
contains only that household's own calendar, tasks and shopping data. It is not
marketing and carries no promotion.
