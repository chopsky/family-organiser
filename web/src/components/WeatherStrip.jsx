/**
 * WeatherStrip - Home-screen weather widget.
 *
 * Recreated from /docs/design_handoff_weather_widget (design reference,
 * not copied verbatim). Collapsed by default: one row of current
 * conditions. Tapping expands a 24-hour horizontally-swipeable forecast
 * plus a context-aware AI note that ties the weather to today's calendar.
 *
 * Data: GET /api/weather/widget (src/services/weather-widget.js). Renders
 * nothing when the household has no address set or the upstream is down
 * (payload.available === false) - the design brief explicitly says to
 * show nothing rather than a broken/placeholder card.
 *
 * Placed in Dashboard between the greeting and the AI composer.
 *
 * onOpenAI: tapping the AI-note row opens the AI composer. Dashboard
 * passes a handler that dispatches the existing 'openChatWidget' event.
 */

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../lib/api';
import { getDeviceLocation, openLocationSettings, requestLocationPermission } from '../lib/location';
import { isNative } from '../lib/platform';

// ── Weather glyphs - minimalist line icons, 24px viewBox (from the brief) ──
const WX = {
  sun: (p = {}) => (
    <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" fill="none" stroke={p.color || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  ),
  partly: (p = {}) => (
    <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" fill="none" stroke={p.color || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.6v1.6M1.6 8h1.6M3.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1" />
      <path d="M17 11.5a4 4 0 0 0-7.7-1.2A3.3 3.3 0 0 0 9.5 17h7.8a2.9 2.9 0 0 0 .2-5.5z" />
    </svg>
  ),
  cloud: (p = {}) => (
    <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" fill="none" stroke={p.color || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18a4.2 4.2 0 0 1-.5-8.4 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 16.5 18z" />
    </svg>
  ),
  rain: (p = {}) => (
    <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" fill="none" stroke={p.color || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 15a4.2 4.2 0 0 1-.5-8.4 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 16.5 15z" />
      <path d="M8.5 18.5l-1 2M12 18.5l-1 2M15.5 18.5l-1 2" />
    </svg>
  ),
};

const SparkleIcon = (p = {}) => (
  <svg width={p.size || 24} height={p.size || 24} viewBox="0 0 24 24" fill={p.color || 'currentColor'} aria-hidden="true">
    <path d="M12 2l1.8 4.7a4 4 0 0 0 2.5 2.5L21 11l-4.7 1.8a4 4 0 0 0-2.5 2.5L12 20l-1.8-4.7a4 4 0 0 0-2.5-2.5L3 11l4.7-1.8a4 4 0 0 0 2.5-2.5L12 2z" />
  </svg>
);

const WX_COLOR = { sun: '#D89B3A', partly: '#D89B3A', cloud: '#8A93A3', rain: '#5B8DE0' };

// Design tokens (from the brief's token table).
const INK = '#1A1620';
const INK2 = '#4A4453';
const INK3 = '#8A8493';
const LINE = 'rgba(26,22,32,0.07)';
const BRAND = '#6C3DD9';
const BRAND_DEEP = '#4A22A8';

export default function WeatherStrip({ onOpenAI }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  // Bumped to force a re-fetch after the user grants location permission.
  const [reloadKey, setReloadKey] = useState(0);

  // Mobile-only: the weather widget is intentionally not shown on the
  // desktop app (≥768px, the design's sidebar breakpoint). We gate on a
  // media query rather than CSS-hiding so desktop never fires the
  // /weather/widget request - which would otherwise trigger a server-side
  // AI-note LLM call for a widget no one sees. Reactive to resize.
  const [isMobile, setIsMobile] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isMobile) return undefined; // don't fetch on desktop
    let cancelled = false;
    (async () => {
      // Device GPS is the PRIMARY location source. Try to read it (prompts
      // for permission on iOS the first time); fall back to the household
      // address server-side when we can't. Never blocks the fetch — a null
      // fix just means "use the saved address".
      let coords = null;
      try {
        coords = await getDeviceLocation();
      } catch {
        coords = null;
      }
      if (cancelled) return;
      const qs = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : '';
      api.get(`/weather/widget${qs}`)
        .then((res) => { if (!cancelled) setData(res.data); })
        .catch(() => { if (!cancelled) setData({ available: false }); });
    })();
    return () => { cancelled = true; };
  }, [isMobile, reloadKey]);

  // "Open Settings" / fix-location handler. On iOS we deep-link to the app's
  // settings page. On Android there is no such deep link, and the usual reason
  // the card shows is that permission was never granted (the dashboard only
  // does silent, skip-if-denied reads) - so re-request it, which surfaces the
  // OS prompt. On grant, force a re-fetch; if permanently denied, fall back to
  // the app settings page so they can flip it manually.
  async function handleFixLocation() {
    if (Capacitor.getPlatform() === 'ios') {
      openLocationSettings();
      return;
    }
    const state = await requestLocationPermission();
    if (state === 'granted') {
      setData(null); // show the skeleton while we re-fetch
      setReloadKey((k) => k + 1);
    } else {
      openLocationSettings();
    }
  }

  // Desktop never shows the widget.
  if (!isMobile) return null;

  // While loading, render a skeleton that reserves the card's space and
  // tells the user it's loading - so it doesn't suddenly pop in. The
  // skeleton matches the collapsed card's height, so the swap to real data
  // is seamless (no layout shift).
  if (!data) {
    return (
      <div
        style={{
          borderRadius: 20,
          border: `1px solid ${LINE}`,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #EAF1FB 0%, #F4F0FB 52%, #FBF1E4 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
          <div className="animate-pulse" style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, background: 'rgba(255,255,255,0.65)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="animate-pulse" style={{ width: 110, height: 16, borderRadius: 6, background: 'rgba(26,22,32,0.08)' }} />
            <div className="animate-pulse" style={{ width: 150, height: 11, borderRadius: 5, background: 'rgba(26,22,32,0.06)', marginTop: 9 }} />
          </div>
          <span style={{ fontSize: 11, color: INK3, fontWeight: 500, whiteSpace: 'nowrap' }}>Loading…</span>
        </div>
      </div>
    );
  }

  // No device location AND no saved address → we can't show weather at all.
  // Rather than a broken card, prompt the user toward the two ways to fix it:
  // enable location (the primary source) or add a home address (the fallback).
  if (!data.available && data.reason === 'no_location') {
    return (
      <div
        style={{
          borderRadius: 20,
          border: `1px solid ${LINE}`,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #EAF1FB 0%, #F4F0FB 52%, #FBF1E4 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
          <div
            style={{
              width: 46, height: 46, borderRadius: 14, flexShrink: 0,
              background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: WX_COLOR.partly,
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={WX_COLOR.partly} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: INK2, lineHeight: 1.45 }}>
            Weather needs your location.{' '}
            {isNative() ? (
              <button
                type="button"
                onClick={handleFixLocation}
                style={{ border: 0, background: 'transparent', padding: 0, color: BRAND, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
              >
                {Capacitor.getPlatform() === 'android' ? 'Enable location' : 'Open Settings'}
              </button>
            ) : (
              <span style={{ color: INK2, fontWeight: 600 }}>Open Settings</span>
            )}{' '}
            to enable it, or add a home address in Family Setup.
          </div>
        </div>
      </div>
    );
  }

  // Loaded but genuinely unavailable (geocode/upstream failure):
  // show nothing rather than a broken card, per the design brief.
  if (!data.available) return null;

  const w = data;
  const Big = WX[w.icon] || WX.partly;

  return (
    <div
      style={{
        borderRadius: 20,
        border: `1px solid ${LINE}`,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #EAF1FB 0%, #F4F0FB 52%, #FBF1E4 100%)',
      }}
    >
      <style>{`.weatherstrip-hours::-webkit-scrollbar{display:none}`}</style>

      {/* Current conditions - always visible, the tap target */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Weather, ${w.now} degrees, ${w.cond}. Tap to ${open ? 'collapse' : 'expand'} hourly forecast.`}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 16px', border: 0, background: 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <div
          style={{
            width: 46, height: 46, borderRadius: 14, flexShrink: 0,
            background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: WX_COLOR[w.icon],
          }}
        >
          <Big size={28} color={WX_COLOR[w.icon]} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-serif-display)', fontSize: 34, lineHeight: 1, color: INK, letterSpacing: -0.5 }}>{w.now}°</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: INK2 }}>{w.cond}</span>
          </div>
          <div style={{ fontSize: 12, color: INK3, marginTop: 3, display: 'flex', gap: 10, whiteSpace: 'nowrap' }}>
            <span>{w.city}</span>
            <span>H {w.high}° · L {w.low}°</span>
            <span>{w.rain}% rain</span>
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0, color: INK3, display: 'flex',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s ease',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </div>
      </button>

      {/* Expandable region - animates via grid-template-rows 0fr->1fr */}
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .28s ease' }}>
        <div style={{ overflow: 'hidden' }}>
          {/* Hourly - horizontally swipeable, 24h */}
          <div
            className="weatherstrip-hours"
            style={{
              display: 'flex', gap: 4, overflowX: 'auto', padding: '0px 14px 14px',
              // scrollPaddingLeft must match the container's padding-left.
              // Without it, scroll-snap aligns the "Now" cell's start edge
              // to the scrollport (padding-box) edge at rest, "scrolling
              // under" the left padding so the highlighted Now cell sits
              // flush against the card edge. Insetting the snapport by the
              // same amount makes the snap land at the padding, keeping the gap.
              scrollPaddingLeft: '14px',
              WebkitOverflowScrolling: 'touch', scrollSnapType: 'x proximity', scrollbarWidth: 'none',
            }}
          >
            {(w.hours || []).map((h, i) => {
              const Ic = WX[h.icon] || WX.partly;
              const isNow = h.t === 'Now';
              return (
                <div
                  key={i}
                  style={{
                    flex: '1 0 auto', minWidth: 52, textAlign: 'center', scrollSnapAlign: 'start',
                    padding: '8px 6px', borderRadius: 13,
                    background: isNow ? 'rgba(255,255,255,0.8)' : 'transparent',
                    border: isNow ? '1px solid rgba(255,255,255,0.95)' : '1px solid transparent',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: isNow ? INK : INK3, marginBottom: 6 }}>{h.t}</div>
                  <div style={{ display: 'flex', justifyContent: 'center', color: WX_COLOR[h.icon], marginBottom: 5 }}><Ic size={18} color={WX_COLOR[h.icon]} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{h.tmp}°</div>
                </div>
              );
            })}
          </div>

          {/* AI note - taps through to the AI composer. Hidden when null. */}
          {w.note && (
            <button
              type="button"
              onClick={onOpenAI}
              aria-label={`${w.note}. Open the assistant.`}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', border: 0, borderTop: '1px solid rgba(26,22,32,0.05)',
                background: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <span style={{ flexShrink: 0, display: 'flex' }}><SparkleIcon size={13} color={BRAND} /></span>
              <span style={{ fontSize: 12, color: BRAND_DEEP, fontWeight: 500 }}>{w.note}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
