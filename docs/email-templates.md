# Trial-lifecycle email templates

Five Postmark templates power the Housemait trial-email lifecycle. The
codepaths that send them live in `src/services/email.js`; this document
gives you copy-ready bodies for the Postmark template editor.

For each template you'll need to set:

- **Template Alias** — the exact string the codebase imports (e.g.
  `housemait-welcome`).
- **Subject** — supports `{{merge_fields}}` exactly like the body.
- **HTML body** — what most clients render.
- **Text body** — fallback for plain-text-only clients (also useful for
  rule-based filters that downrank HTML-only mail).
- **Stream** — `transactional` for welcome / expired, `broadcast` for
  the day-20 / 25 / 28 nudges. The codebase already passes the right
  stream — Postmark just needs both streams to exist.

The HTML uses inline styles only (most email clients strip `<style>`
blocks). Brand colours match `CLAUDE.md`:

| Token       | Hex       |
| ----------- | --------- |
| Plum        | `#6B3FA0` |
| Coral       | `#E8724A` |
| Sage        | `#7DAE82` |
| Charcoal    | `#2D2A33` |
| Warm Grey   | `#6B6774` |
| Cream       | `#FBF8F3` |
| Light Grey  | `#E8E5EC` |

---

## 1. `housemait-welcome` — Day 1

**When:** Inline from `POST /api/auth/create-household`. Fires the
moment a user finishes signup + creates their household.

**Stream:** `transactional` (always sends — ignores opt-out).

**Merge fields available:**

| Field | Example value |
| ----- | ------------- |
| `{{first_name}}` | `Sarah` (falls back to `there` if missing) |
| `{{trial_end_date}}` | `21 May 2026` |
| `{{app_url}}` | `https://housemait.com` |

### Subject

```
Welcome to Housemait, {{first_name}}!
```

### Text body

```
Hi {{first_name}},

Welcome aboard. Your free 30-day trial of Housemait is up and running
— your whole household has full access until {{trial_end_date}}.

Here's where to start:

  • Add your family — invite your partner or older kids so they can
    add shopping items, see the calendar, and tick things off.
  • Set up your shopping list — try saying "add milk" to the WhatsApp
    bot, or scan a receipt to auto-tick what you've bought.
  • Drop in this week's meals — drag recipes onto the planner and
    we'll build the shopping list for you.

We'll send a couple of optional check-ins as your trial progresses,
plus one reminder when it's about to end.

You can manage your subscription, billing, and family settings any
time at {{app_url}}.

Questions? Just reply — this email goes straight to the team.

— The Housemait team
```

### HTML body

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to Housemait</title>
</head>
<body style="margin:0;padding:0;background-color:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D2A33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF8F3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(107,63,160,0.06);">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <div style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:28px;line-height:1.1;letter-spacing:-0.01em;color:#6B3FA0;">
                Housemait
              </div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:8px 32px 16px 32px;">
              <h1 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:32px;line-height:1.15;letter-spacing:-0.02em;color:#2D2A33;font-weight:400;">
                Welcome aboard, {{first_name}}.
              </h1>
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                Your free 30-day trial is up and running — your whole household has full access until <strong style="color:#6B3FA0;">{{trial_end_date}}</strong>.
              </p>
            </td>
          </tr>

          <!-- Getting started list -->
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <h2 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:20px;color:#2D2A33;font-weight:400;">
                Where to start
              </h2>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:6px 0;vertical-align:top;font-size:15px;line-height:1.55;color:#2D2A33;">
                    <strong style="color:#6B3FA0;">1.&nbsp;</strong>&nbsp;<strong>Add your family</strong> — invite your partner or older kids so they can add shopping items, see the calendar, and tick things off.
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;font-size:15px;line-height:1.55;color:#2D2A33;">
                    <strong style="color:#6B3FA0;">2.&nbsp;</strong>&nbsp;<strong>Set up your shopping list</strong> — try saying <em>"add milk"</em> to the WhatsApp bot, or scan a receipt to auto-tick what you've bought.
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;font-size:15px;line-height:1.55;color:#2D2A33;">
                    <strong style="color:#6B3FA0;">3.&nbsp;</strong>&nbsp;<strong>Drop in this week's meals</strong> — drag recipes onto the planner and we'll build the shopping list for you.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:24px 32px 8px 32px;">
              <a href="{{app_url}}/dashboard" style="display:inline-block;padding:14px 28px;background-color:#6B3FA0;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                Open Housemait
              </a>
            </td>
          </tr>

          <!-- What's next -->
          <tr>
            <td style="padding:16px 32px 8px 32px;border-top:1px solid #E8E5EC;">
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:#6B6774;">
                We'll send a couple of optional check-ins as your trial progresses, plus one reminder when it's about to end. You can manage your subscription and family settings any time at <a href="{{app_url}}" style="color:#6B3FA0;text-decoration:none;">housemait.com</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#6B6774;">
                Questions? Just reply to this email — it goes straight to the team.
              </p>
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#6B6774;">
                — The Housemait team
              </p>
            </td>
          </tr>
        </table>

        <!-- Outer footer -->
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding:16px 16px 0 16px;font-size:12px;color:#6B6774;line-height:1.5;">
              You're receiving this because you signed up at <a href="{{app_url}}" style="color:#6B3FA0;text-decoration:none;">housemait.com</a>.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. `housemait-trial-day-20` — Day 20

**When:** Daily 09:00 BST cron, 20 days after `trial_started_at`.

**Stream:** `broadcast` (skipped if `trial_emails_enabled = false`).

**Merge fields:**

| Field | Example value |
| ----- | ------------- |
| `{{first_name}}` | `Sarah` |
| `{{trial_end_date}}` | `21 May 2026` |
| `{{days_remaining}}` | `10` |
| `{{app_url}}` | `https://housemait.com` |
| `{{subscribe_url}}` | `https://housemait.com/subscribe` |
| `{{unsubscribe_url}}` | one-click unsubscribe link |
| `{{family_members_count}}` | `4` |
| `{{items_added}}` | `47` (shopping items) |
| `{{meals_planned}}` | `12` |
| `{{tasks_completed}}` | `38` |
| `{{events_added}}` | `15` |

### Subject

```
How's it going, {{first_name}}?
```

### Text body

```
Hi {{first_name}},

You've got {{days_remaining}} days left on your Housemait trial — and
it looks like you've been busy:

  • {{family_members_count}} family members on board
  • {{items_added}} shopping items added
  • {{events_added}} events on the calendar
  • {{meals_planned}} meals planned
  • {{tasks_completed}} tasks completed

Your trial ends on {{trial_end_date}}. To keep going, subscribe at
{{subscribe_url}} — £5.99/month or £59.99/year (saves £11.89).

Not feeling it yet? No worries. Just let it expire — we'll keep your
data for 30 days in case you change your mind.

— The Housemait team

—
You're receiving this because you signed up for Housemait.
Stop these check-ins: {{unsubscribe_url}}
```

### HTML body

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>How's your Housemait trial going?</title>
</head>
<body style="margin:0;padding:0;background-color:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D2A33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF8F3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(107,63,160,0.06);">

          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <div style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:1.1;letter-spacing:-0.01em;color:#6B3FA0;">
                Housemait
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 12px 32px;">
              <h1 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:#2D2A33;font-weight:400;">
                How's it going, {{first_name}}?
              </h1>
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                {{days_remaining}} days left on your trial — and you've been busy.
              </p>
            </td>
          </tr>

          <!-- Usage stats card -->
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3EDFC;border-radius:12px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:4px 0;font-size:15px;line-height:1.55;color:#2D2A33;">
                          <strong style="color:#6B3FA0;">{{family_members_count}}</strong> family members on board
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:15px;line-height:1.55;color:#2D2A33;">
                          <strong style="color:#6B3FA0;">{{items_added}}</strong> shopping items added
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:15px;line-height:1.55;color:#2D2A33;">
                          <strong style="color:#6B3FA0;">{{events_added}}</strong> calendar events
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:15px;line-height:1.55;color:#2D2A33;">
                          <strong style="color:#6B3FA0;">{{meals_planned}}</strong> meals planned
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:15px;line-height:1.55;color:#2D2A33;">
                          <strong style="color:#6B3FA0;">{{tasks_completed}}</strong> tasks completed
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                Your trial ends on <strong style="color:#6B3FA0;">{{trial_end_date}}</strong>. Subscribe to keep going:
              </p>
            </td>
          </tr>

          <!-- Pricing pair -->
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px solid #E8E5EC;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B6774;">Monthly</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£5.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /mo</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3EDFC;border:1.5px solid #6B3FA0;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B3FA0;font-weight:600;">Annual · Best value</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£59.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /yr</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 8px 32px;">
              <a href="{{subscribe_url}}" style="display:inline-block;padding:14px 28px;background-color:#6B3FA0;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                Subscribe
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 28px 32px;border-top:1px solid #E8E5EC;">
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:#6B6774;">
                Not feeling it yet? No worries. Just let it expire — we'll keep your data for 30 days in case you change your mind.
              </p>
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#6B6774;">
                — The Housemait team
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding:16px 16px 0 16px;font-size:12px;color:#6B6774;line-height:1.5;">
              You're receiving this because you signed up at <a href="{{app_url}}" style="color:#6B3FA0;text-decoration:none;">housemait.com</a>.<br />
              <a href="{{unsubscribe_url}}" style="color:#6B6774;text-decoration:underline;">Stop these check-ins</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. `housemait-trial-day-25` — Day 25

**Same merge fields as day 20**, but `{{days_remaining}}` will be `5`.

**Stream:** `broadcast`.

### Subject

```
5 days left, {{first_name}}
```

### Text body

```
Hi {{first_name}},

Quick heads-up: your Housemait trial ends on {{trial_end_date}} —
just {{days_remaining}} days from now.

Subscribe to keep using the app uninterrupted: {{subscribe_url}}

  • £5.99 / month
  • £59.99 / year (saves you £11.89)

If you decide not to subscribe, your account will be paused and your
data preserved for 30 days. You can come back any time and pick up
right where you left off.

— The Housemait team

—
Stop these reminders: {{unsubscribe_url}}
```

### HTML body

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>5 days left on your Housemait trial</title>
</head>
<body style="margin:0;padding:0;background-color:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D2A33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF8F3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(107,63,160,0.06);">

          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <div style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:1.1;letter-spacing:-0.01em;color:#6B3FA0;">
                Housemait
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 16px 32px;">
              <h1 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:#2D2A33;font-weight:400;">
                {{days_remaining}} days left, {{first_name}}.
              </h1>
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                Your Housemait trial ends on <strong style="color:#6B3FA0;">{{trial_end_date}}</strong>. Subscribe to keep using the app without interruption.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px solid #E8E5EC;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B6774;">Monthly</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£5.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /mo</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3EDFC;border:1.5px solid #6B3FA0;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B3FA0;font-weight:600;">Annual · Saves £10</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£59.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /yr</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 8px 32px;">
              <a href="{{subscribe_url}}" style="display:inline-block;padding:14px 28px;background-color:#6B3FA0;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                Subscribe
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 28px 32px;border-top:1px solid #E8E5EC;">
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:#6B6774;">
                If you decide not to subscribe, your account will be paused and your data preserved for 30 days. You can come back any time and pick up right where you left off.
              </p>
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#6B6774;">
                — The Housemait team
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding:16px 16px 0 16px;font-size:12px;color:#6B6774;line-height:1.5;">
              <a href="{{unsubscribe_url}}" style="color:#6B6774;text-decoration:underline;">Stop these reminders</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 4. `housemait-trial-day-28` — Day 28

**Same merge fields as day 20**, but `{{days_remaining}}` will be `2`.

**Stream:** `broadcast`.

### Subject

```
Your Housemait trial ends in {{days_remaining}} days
```

### Text body

```
Hi {{first_name}},

Last reminder — your trial ends on {{trial_end_date}}.

Subscribe now to avoid interruption: {{subscribe_url}}

  • £5.99 / month
  • £59.99 / year (saves £11.89 vs monthly)

One subscription covers your whole household — every family member
gets full access.

— The Housemait team

—
Stop these reminders: {{unsubscribe_url}}
```

### HTML body

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Housemait trial ends soon</title>
</head>
<body style="margin:0;padding:0;background-color:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D2A33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF8F3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(107,63,160,0.06);">

          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <div style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:1.1;letter-spacing:-0.01em;color:#6B3FA0;">
                Housemait
              </div>
            </td>
          </tr>

          <!-- Coral banner — final-push urgency -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <div style="display:inline-block;padding:6px 12px;background-color:#FDF0EB;color:#E8724A;font-size:13px;font-weight:600;border-radius:8px;">
                ⏰ {{days_remaining}} days remaining
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 16px 32px;">
              <h1 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:#2D2A33;font-weight:400;">
                Last call, {{first_name}}.
              </h1>
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                Your Housemait trial ends on <strong style="color:#E8724A;">{{trial_end_date}}</strong>. Subscribe today to keep your family's plans, lists and meals running.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px solid #E8E5EC;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B6774;">Monthly</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£5.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /mo</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3EDFC;border:1.5px solid #6B3FA0;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;font-size:13px;color:#6B3FA0;font-weight:600;">Annual · Saves £10</p>
                          <p style="margin:4px 0 0 0;font-size:20px;font-weight:600;color:#2D2A33;">£59.99<span style="font-size:13px;color:#6B6774;font-weight:400;"> /yr</span></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 8px 32px;">
              <a href="{{subscribe_url}}" style="display:inline-block;padding:14px 28px;background-color:#E8724A;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                Subscribe now
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 28px 32px;border-top:1px solid #E8E5EC;">
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:#6B6774;">
                One subscription covers your whole household — every family member gets full access.
              </p>
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#6B6774;">
                — The Housemait team
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding:16px 16px 0 16px;font-size:12px;color:#6B6774;line-height:1.5;">
              <a href="{{unsubscribe_url}}" style="color:#6B6774;text-decoration:underline;">Stop these reminders</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 5. `housemait-trial-expired` — Day 30

**When:** Daily 09:00 BST cron, 30 days after `trial_started_at`.

**Stream:** `transactional` (always sends — even if user opted out).

**Merge fields:**

| Field | Example value |
| ----- | ------------- |
| `{{first_name}}` | `Sarah` |
| `{{trial_end_date}}` | `21 May 2026` |
| `{{app_url}}` | `https://housemait.com` |
| `{{subscribe_url}}` | `https://housemait.com/subscribe` |

> **Important:** This is the email an iOS user will see when their app
> "stops accepting writes". The paragraph that mentions iOS in the
> body is the bridge — keep it in.

### Subject

```
Your Housemait trial has ended
```

### Text body

```
Hi {{first_name}},

Your free trial ended on {{trial_end_date}}. We hope Housemait was
useful for your household!

Your data is safe. We'll keep it on hand for 30 days in case you'd
like to come back. To resume access, subscribe at {{subscribe_url}}.

If you're using Housemait on iOS or another mobile device and writes
have stopped working: that's expected — the trial is over. Once
you've subscribed on the web, your apps will pick up immediately,
no re-install or re-login needed.

Thanks for trying us.

— The Housemait team
```

### HTML body

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Housemait trial has ended</title>
</head>
<body style="margin:0;padding:0;background-color:#FBF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D2A33;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF8F3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(107,63,160,0.06);">

          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <div style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:1.1;letter-spacing:-0.01em;color:#6B3FA0;">
                Housemait
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 16px 32px;">
              <h1 style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,serif;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:#2D2A33;font-weight:400;">
                Your trial has ended.
              </h1>
              <p style="margin:0;font-size:16px;line-height:1.55;color:#2D2A33;">
                Your free trial ended on <strong style="color:#6B3FA0;">{{trial_end_date}}</strong>. We hope Housemait was useful for your household, {{first_name}}.
              </p>
            </td>
          </tr>

          <!-- Reassurance card -->
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDF5EE;border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0;font-size:15px;line-height:1.55;color:#2D2A33;">
                      <strong style="color:#7DAE82;">✓ Your data is safe.</strong> We'll keep your household's lists, meals, calendar and tasks for 30 days — so you can come back any time and pick up where you left off.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:24px 32px 8px 32px;">
              <a href="{{subscribe_url}}" style="display:inline-block;padding:14px 28px;background-color:#6B3FA0;color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                Subscribe & resume access
              </a>
            </td>
          </tr>

          <!-- iOS-specific paragraph: this is the BRIDGE for iOS users -->
          <tr>
            <td style="padding:24px 32px 8px 32px;border-top:1px solid #E8E5EC;">
              <h2 style="margin:16px 0 8px 0;font-family:'Instrument Serif',Georgia,serif;font-size:18px;color:#2D2A33;font-weight:400;">
                Using Housemait on a phone or tablet?
              </h2>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#6B6774;">
                If your iOS or mobile app has stopped saving changes — that's expected, the trial is over. Once you've subscribed on the web, your apps will pick up immediately. No re-install or re-login needed.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <p style="margin:0;font-size:14px;line-height:1.55;color:#6B6774;">
                Thanks for trying us.
              </p>
              <p style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:#6B6774;">
                — The Housemait team
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding:16px 16px 0 16px;font-size:12px;color:#6B6774;line-height:1.5;">
              This is a transactional email about your account.<br />
              <a href="{{app_url}}" style="color:#6B3FA0;text-decoration:none;">housemait.com</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

---

## How to load these into Postmark

For each of the five templates above:

1. Postmark dashboard → your server → **Templates** → find or create
   the template by alias (`housemait-welcome`, `housemait-trial-day-20`,
   `housemait-trial-day-25`, `housemait-trial-day-28`,
   `housemait-trial-expired`).
2. Set the **Subject** field to the line under "### Subject".
3. Paste the HTML body into the **HTML** tab.
4. Paste the text body into the **Text** tab.
5. Postmark validates the merge-field syntax automatically — fix any
   typos it flags.
6. Use Postmark's **Send Test** feature with sample values for the
   merge fields to spot-check the rendering before saving.

## How to verify

- Trigger `runTrialEmailCheck()` manually from the admin console (the
  scheduler exposes `triggerTrialEmails` for ad-hoc runs — see
  `src/jobs/scheduler.js` line ~492). This will fire any households
  due that day.
- Or wait 24 hours and check Postmark's Activity tab — every send is
  logged with the rendered subject + body, so you can see exactly
  what your users get.
