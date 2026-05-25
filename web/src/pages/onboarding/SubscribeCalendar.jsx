/**
 * Step 5 - subscribe one of the user's existing third-party calendars
 * (Apple / Google / Outlook / school) into Housemait, read-only.
 *
 * This is the INVERSE of ConnectCalendar (which exposes the Housemait
 * outbound feed to the user's phone calendar): here the user pastes
 * an iCal URL from a calendar they already keep, and Housemait shows
 * those events alongside its own. Combined, the two steps mean
 * Housemait can become the user's single calendar surface - they see
 * everything in one place, edit Housemait-native events here, and
 * still edit their work / school / family calendars in their source
 * apps.
 *
 * Onboarding scope is iCal-subscribe only (POST /calendar/external-feeds).
 * OAuth-based two-way sync remains a Settings-only flow because the
 * OAuth redirect would navigate away from the wizard mid-flow.
 *
 * Instruction copy adapts to platform: iOS users get the iPhone
 * Calendar-app path for Apple + a fiddly-but-doable Safari-desktop-
 * mode path for Google / Outlook; web users get the desktop URLs
 * directly. Mirrors the same flow used in Settings → Connect
 * Calendars → Subscribed calendars.
 */

import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../../lib/api';
import {
  serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink,
} from './_styles';

const FEED_COLOR_PALETTE = [
  'red', 'burnt-orange', 'amber', 'gold',
  'leaf', 'emerald', 'teal', 'sky',
  'cobalt', 'indigo', 'purple', 'magenta',
  'rose', 'terracotta', 'moss', 'slate',
];
const FEED_COLOR_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
};

export default function SubscribeCalendar({ next, setError }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState('sky');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function handleAdd(e) {
    e?.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      setError?.('Please give the calendar a name and paste the URL.');
      return;
    }
    setAdding(true);
    try {
      await api.post('/calendar/external-feeds', {
        feed_url: trimmedUrl,
        display_name: trimmedName,
        color,
      });
      setAdded(true);
      // Brief success state, then advance. The first fetch from the
      // remote URL kicks off server-side; user will see events in the
      // calendar within a minute or two.
      setTimeout(() => next(), 1500);
    } catch (err) {
      setError?.(err.response?.data?.error || "Couldn't add that calendar. Double-check the URL and try again, or set it up later in Settings.");
    } finally {
      setAdding(false);
    }
  }

  if (added) {
    return (
      <div className="text-center">
        <div
          className="mx-auto mb-8 flex items-center justify-center"
          style={{
            width: '72px', height: '72px', borderRadius: '20px',
            background: 'var(--color-sage-light)', fontSize: '32px',
          }}
          aria-hidden="true"
        >
          ✅
        </div>
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Calendar added
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          You're <i>all in one place</i>.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          Events from your subscribed calendar will appear in Housemait within a minute.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Step 5 - Calendar
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          Pull in your <i>other calendars</i>.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          See your work, school, or personal events alongside everything
          else in Housemait. Read-only - edits still happen in the source
          calendar.
        </p>
      </div>

      <form onSubmit={handleAdd} className="mt-8 max-w-md mx-auto space-y-3">
        <input
          type="text"
          placeholder="Calendar name (e.g. Work, School, Sasha's iCloud)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-cream-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-bark"
        />
        <input
          type="url"
          placeholder="https://… or webcal://… (iCal feed URL)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full border border-cream-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-bark"
        />
        <div>
          <p className="text-xs text-cocoa mb-1.5">Colour <span className="text-cocoa">(how this calendar's events appear on the grid)</span></p>
          <div className="flex flex-wrap gap-2">
            {FEED_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                aria-label={`Set colour ${c}`}
                className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-bark ring-offset-2 ring-offset-white scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: FEED_COLOR_HEX[c] }}
              />
            ))}
          </div>
        </div>

        {/* Platform-aware instructions. Mirrors the equivalent block in
            Settings → Subscribed calendars; updates there should be
            reflected here too. */}
        {Capacitor.isNativePlatform() ? (
          <div className="text-xs text-cocoa space-y-2 pt-1">
            <p>
              <span className="font-medium">Apple:</span> open the iPhone <span className="font-medium">Calendar</span> app → tap <span className="font-medium">Calendars</span> at the bottom → tap <span className="font-medium">(i)</span> next to a calendar → turn on <span className="font-medium">Public Calendar</span> → <span className="font-medium">Share Link…</span> → <span className="font-medium">Copy</span>.
            </p>
            <p>
              <span className="font-medium">Google / Outlook:</span> easier on a computer. <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">calendar.google.com</a> → Settings → pick a calendar → <span className="font-medium">Integrate calendar</span> → copy <span className="font-medium">Secret address in iCal format</span>.
            </p>
            <p className="italic">
              You can also skip this and add a calendar later from Settings → Connect Calendars.
            </p>
          </div>
        ) : (
          <div className="text-xs text-cocoa space-y-1 pt-1">
            <p>
              <span className="font-medium">Apple:</span> sign in at <a href="https://www.icloud.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">iCloud.com</a> → Calendar → click the share icon next to your calendar → tick <span className="font-medium">Public Calendar</span> → copy URL.
            </p>
            <p>
              <span className="font-medium">Google:</span> <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">calendar.google.com</a> → Settings for my calendars → pick a calendar → Integrate calendar → copy <span className="font-medium">Secret address in iCal format</span>.
            </p>
            <p>
              <span className="font-medium">Outlook:</span> <a href="https://outlook.live.com/calendar" target="_blank" rel="noopener noreferrer" className="text-primary underline">outlook.live.com/calendar</a> → Settings → Shared calendars → Publish a calendar → pick <span className="font-medium">Can view all details</span> → copy ICS URL.
            </p>
          </div>
        )}

        <div className="flex flex-col items-center gap-3 pt-4">
          <button
            type="submit"
            disabled={adding}
            className={primaryBtn}
          >
            {adding ? 'Adding…' : 'Subscribe to calendar'}
          </button>
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
}
