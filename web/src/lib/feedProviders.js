// Per-provider wizard steps for subscribing to an external calendar by URL.
// Shared by Settings → Connect Calendars and the onboarding calendar step.
// `link` deep-links as close to the page holding the address as each provider
// allows - Outlook lands EXACTLY on the publish page; Google can only deep-link
// to settings (the per-calendar page needs an id we can't know).
export const FEED_PROVIDERS = [
  {
    id: 'google',
    label: 'Google calendar',
    link: 'https://calendar.google.com/calendar/u/0/r/settings',
    linkLabel: 'Open Google Calendar settings',
    steps: [
      'Pick your calendar on the left, under "Settings for my calendars".',
      'Scroll to "Integrate calendar".',
      'Copy "Secret address in iCal format" and paste it below.',
    ],
    placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    iosTip: 'On a phone, tap AA in Safari\'s address bar → Request Desktop Website first.',
  },
  {
    id: 'outlook',
    label: 'Outlook calendar',
    link: 'https://outlook.live.com/calendar/0/options/calendar/SharedCalendars',
    linkLabel: 'Open Outlook\'s publish page',
    steps: [
      'Under "Publish a calendar", choose the calendar and "Can view all details", then click Publish.',
      'Copy the ICS link it shows and paste it below.',
    ],
    placeholder: 'https://outlook.live.com/owa/calendar/…/calendar.ics',
    iosTip: 'On a phone, tap AA in Safari\'s address bar → Request Desktop Website first.',
  },
  {
    id: 'apple',
    label: 'Apple calendar',
    link: 'https://www.icloud.com/calendar',
    linkLabel: 'Open iCloud Calendar',
    steps: [
      'Click the share icon next to the calendar in the left sidebar.',
      'Tick "Public Calendar" and copy the webcal:// link.',
      'Paste it below.',
    ],
    placeholder: 'webcal://p12-caldav.icloud.com/published/…',
    // On the iPhone the Calendar app beats iCloud.com - swapped in at render.
    iosSteps: [
      'Open the iPhone Calendar app → tap "Calendars" at the bottom.',
      'Tap (i) next to the calendar → turn on "Public Calendar".',
      'Tap "Share Link…" → Copy, then paste it below.',
    ],
  },
];
