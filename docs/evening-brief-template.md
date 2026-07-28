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
Evening, {{1}}! Here's how tomorrow's looking:

🌤️ {{3}}

📅 {{2}}'s schedule
{{4}}

📋 Reminders
{{5}}

🛒 {{6}}

💡 {{7}}
```

The weekday sits in the schedule heading rather than in the opener. Bracketing
it after "tomorrow" — "Here's how tomorrow (Thursday) looks" — reads like a
database field rather than a person.

### Variables

Produced by `buildDailyReminderTemplateVars(member, { variant: 'evening', … })`.
Every one is guaranteed non-empty and single-line — the builder substitutes a
fallback phrase rather than ever emitting `""`, which would trip 21656.

| Var | Meaning | Sample for submission |
|---|---|---|
| `{{1}}` | First name | `Jade` |
| `{{2}}` | Tomorrow's weekday | `Thursday` |
| `{{3}}` | Weather one-liner | `14-19°, light rain in the afternoon` |
| `{{4}}` | Tomorrow's events, joined by ` · ` | `08:45 - School run (Jade) · 16:00 - Swimming (Ella)` |
| `{{5}}` | Tasks + bills due, joined by ` · ` | `Sign the trip form due tomorrow · Council tax due Friday` |
| `{{6}}` | Shopping count phrase | `3 items on the shopping list` |
| `{{7}}` | Tomorrow's dinner, else a rotating tip | `Tomorrow's dinner: Fish pie - 40 min` |

Empty-state values (also non-empty strings): `{{4}}` → `Nothing scheduled
tomorrow`, `{{5}}` → `Nothing due tomorrow`, `{{6}}` → `Shopping list is empty`.

## Notes for the reviewer

If Meta queries the category: this is sent only to users who explicitly switched
on "Evening heads-up" in Settings → Notifications (opt-in, default off), and
contains only that household's own calendar, tasks and shopping data. It is not
marketing and carries no promotion.
