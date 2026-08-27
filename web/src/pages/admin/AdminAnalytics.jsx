import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconTrendingUp } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import DateRangeToggle, { DAYS_ALL } from '../../components/DateRangeToggle';
import ErrorBanner from '../../components/ErrorBanner';

function rangeLabel(days) {
  if (days === DAYS_ALL) return 'all time';
  return `${days}d`;
}

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get('/admin/analytics', { params: { days } })
      .then(({ data }) => setData(data))
      .catch((err) => {
        console.error('Failed to load analytics:', err);
        setError('Could not load analytics. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [days, reloadKey]);

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const {
    dau = [], featureUsage = {}, funnel = {}, wau = 0,
    retention = null, channelCohorts = null, calendarConnection = null, appleAds = null,
    acquisition = null, inviteLoop = null, referrals = null, signupSources = null, pendingReplyLeaks = null, paywallFunnel = null, onboardingFunnel = null, meterStats = null,
  } = data || {};

  // Calculate DAU average
  const recentDau = dau.slice(-7);
  const avgDau = recentDau.length > 0
    ? Math.round(recentDau.reduce((sum, d) => sum + d.activeUsers, 0) / recentDau.length)
    : 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <IconTrendingUp className="h-6 w-6 text-plum" />
            <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Analytics</h1>
          </div>
          <p className="text-warm-grey text-sm">User activity, feature usage, and onboarding</p>
        </div>
        <DateRangeToggle value={days} onChange={setDays} />
      </div>

      <div className="mt-4">
        <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{avgDau}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Avg DAU (7d)</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{wau}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">WAU</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">
            {Object.values(featureUsage).reduce((a, b) => a + (b?.created || 0) + (b?.completed || 0), 0)}
          </p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Actions ({rangeLabel(days)})</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{funnel.registered ?? 0}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Registered Users</p>
        </div>
      </div>

      {/* Calendar connection - the activation keystone. Once a household has a
          live calendar, the dashboard/brief/reminders all have content. */}
      <CalendarConnection stats={calendarConnection} />

      {/* Per-household activation buckets + weekly retention curve */}
      <ActivationRetention />
      <AiMisses />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {/* Feature Usage */}
        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Feature Usage ({rangeLabel(days)})</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Feature</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Created</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(featureUsage)
                  .sort((a, b) => ((b[1]?.created || 0) + (b[1]?.completed || 0)) - ((a[1]?.created || 0) + (a[1]?.completed || 0)))
                  .map(([feature, stats]) => (
                    <tr key={feature} className="border-b border-light-grey last:border-0">
                      <td className="px-4 py-3 font-medium text-charcoal capitalize">{feature}</td>
                      <td className="px-4 py-3 text-right text-charcoal">{stats?.created ?? 0}</td>
                      <td className="px-4 py-3 text-right text-charcoal">
                        {stats?.completed === undefined ? <span className="text-warm-grey">—</span> : stats.completed}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Onboarding Funnel */}
        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Onboarding Funnel</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <FunnelStep label="Registered" value={funnel.registered ?? 0} total={funnel.registered} />
            <FunnelStep label="Email Verified" value={funnel.verified ?? 0} total={funnel.registered} />
            <FunnelStep label="Joined Household" value={funnel.joinedHousehold ?? 0} total={funnel.registered} />
            <div className="mt-4 pt-4 border-t border-light-grey">
              <div className="flex items-center justify-between text-sm">
                <span className="text-warm-grey">Invites Sent</span>
                <span className="font-medium text-charcoal">{funnel.invitesSent ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-warm-grey">Invites Accepted</span>
                <span className="font-medium text-charcoal">{funnel.invitesAccepted ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Acquisition by platform — the ad-relevant cut. iOS column maps to
          Apple Search Ads installs; web_only is the browser cohort. */}
      {acquisition && acquisition.total > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Acquisition by platform (last {acquisition.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Apple Search Ads drives <strong>iOS</strong> installs only — compare that column against Apple&rsquo;s install count.
            &ldquo;Web only&rdquo; = signed up in a browser, never opened the native app. Sub-counts are of that segment&rsquo;s sign-ups.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { key: 'ios', label: '📱 iOS app' },
              { key: 'web_only', label: '🌐 Web only' },
              { key: 'android', label: '🤖 Android app' },
            ].map(({ key, label }) => {
              const s = acquisition.segments?.[key] || { signups: 0, verified: 0, onboarded: 0, whatsapp: 0, subscribed: 0 };
              const pct = (n) => (s.signups ? Math.round((n / s.signups) * 100) : 0);
              const rows = [
                ['Verified', s.verified], ['Onboarded', s.onboarded],
                ['WhatsApp linked', s.whatsapp], ['Subscribed', s.subscribed],
              ];
              return (
                <div key={key} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-sm font-medium text-charcoal">{label}</span>
                    <span className="text-2xl font-bold text-plum">{s.signups}<span className="text-xs font-medium text-warm-grey ml-1">sign-ups</span></span>
                  </div>
                  {rows.map(([lbl, val]) => (
                    <div key={lbl} className="flex items-center justify-between text-sm mt-1.5">
                      <span className="text-warm-grey">{lbl}</span>
                      <span className="font-medium text-charcoal">{val} <span className="text-warm-grey">({pct(val)}%)</span></span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signups by source tag: the self-serve "are the ads working?" table.
          "via ads" = the account was created carrying a Google Ads click id. */}
      {signupSources && signupSources.total > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Sign-ups by source (last {signupSources.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            <strong>termdates</strong> = the school-term-dates funnel; <strong>via ads</strong> = arrived on a Google Ads
            click (gclid). Untagged = every signup with no acquisition tag (App Store, direct, word of mouth).
          </p>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-warm-grey">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4 text-right">Sign-ups</th>
                  <th className="py-2 pr-4 text-right">via ads</th>
                  <th className="py-2 text-right">Onboarded</th>
                </tr>
              </thead>
              <tbody>
                {signupSources.sources.map((row) => (
                  <tr key={row.source} className="border-t border-light-grey">
                    <td className="py-2 pr-4 font-medium text-charcoal">{row.source === 'untagged' ? <span className="text-warm-grey">(untagged)</span> : row.source}</td>
                    <td className="py-2 pr-4 text-right font-bold text-plum">{row.signups}</td>
                    <td className="py-2 pr-4 text-right">{row.viaAds > 0 ? row.viaAds : <span className="text-warm-grey">—</span>}</td>
                    <td className="py-2 text-right">{row.onboarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Party invite loop: links → opens → RSVPs → attributed signups */}
      {inviteLoop && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Party invite loop (last {inviteLoop.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Hosts share one RSVP link per event; invitee families RSVP without an account and see a
            Housemait pitch after. <strong>Signups</strong> = accounts created with <code>src=rsvp</code>.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              ['Links created', inviteLoop.links],
              ['Link opens', inviteLoop.views],
              ['RSVPs', inviteLoop.rsvps],
              ['Families going', inviteLoop.rsvpYes],
              ['Signups', inviteLoop.signups],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 text-center">
                <div className="text-2xl font-bold text-plum">{val}</div>
                <div className="text-xs text-warm-grey mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The hard-wall scoreboard: decides the soft-wall flip (docs/spec-soft-wall-free-mode.md) */}
      {paywallFunnel && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Paywall funnel (last {paywallFunnel.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            iOS onboarding wall. Decision thresholds: flip to the soft wall only if signups fall
            &gt;60% AND completion &lt;25% over a fortnight. <strong>Fallthrough</strong> = the wall
            failed open (store trouble) - by design, not a user choice.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {[
              ['Wall-eligible signups', paywallFunnel.eligibleSignups],
              ['Wall shown', paywallFunnel.shown],
              ['Converted', paywallFunnel.converted + paywallFunnel.restored],
              ['Skipped', paywallFunnel.skipped],
              ['Abandoned', paywallFunnel.abandoned],
              ['Fallthrough', paywallFunnel.fallthrough],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 text-center">
                <div className="text-2xl font-bold text-plum">{val}</div>
                <div className="text-xs text-warm-grey mt-1">{label}</div>
              </div>
            ))}
          </div>
          {paywallFunnel.shown > 0 && (
            <p className="text-sm text-warm-grey mt-3">
              Completion: <strong className="text-charcoal">
                {Math.round(((paywallFunnel.converted + paywallFunnel.restored) / paywallFunnel.shown) * 100)}%
              </strong> of walls shown
            </p>
          )}
        </div>
      )}

      {/* The assistant meter: upgrade pressure on the free tier. Panel appears
          once FREE_APP_MODE ships data; exhausted = the direct conversion gauge. */}
      {meterStats && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Assistant meter (this month)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Free-tier usage of the 15 monthly AI uses. <strong>Exhausted</strong> households hit
            the limit - the direct upgrade-pressure gauge; the number itself is the only
            tuning knob (one constant in assistant-meter.js).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              ['Lapsed households', meterStats.lapsedHouseholds],
              ['Used the bot', meterStats.activeThisMonth],
              ['Actions charged', meterStats.actionsThisMonth],
              ['Near limit (12-14)', meterStats.nearLimit],
              ['Exhausted (15)', meterStats.exhausted],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 text-center">
                <div className="text-2xl font-bold text-plum">{val}</div>
                <div className="text-xs text-warm-grey mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The pre-account staircase: iOS accounts are created at the END of the flow,
          so the signups funnel above can't see where people quit. This can. */}
      {onboardingFunnel && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Onboarding steps (last {onboardingFunnel.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Anonymous per-device step tracking from inside the app flow - it sees the
            pre-account drop the signup funnel can't. <strong>Reached</strong> counts devices
            whose furthest step was this one or later; conditional steps (kids, inbox) read
            lower by design because not every household sees them.
          </p>
          {onboardingFunnel.starts === 0 ? (
            <p className="text-sm text-warm-grey">No events yet - data starts flowing with the next app build.</p>
          ) : (
            <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
              <p className="text-sm text-warm-grey mb-3">
                Devices that started: <strong className="text-charcoal">{onboardingFunnel.starts}</strong>
              </p>
              <div className="space-y-1.5">
                {onboardingFunnel.steps.map(({ step, reached, skipped }) => (
                  <div key={step} className="flex items-center gap-3 text-sm">
                    <div className="w-24 shrink-0 text-warm-grey">{step}</div>
                    <div className="flex-1 h-4 bg-plum-light rounded overflow-hidden">
                      <div
                        className="h-full bg-plum rounded"
                        style={{ width: `${Math.round((reached / onboardingFunnel.starts) * 100)}%` }}
                      />
                    </div>
                    <div className="w-28 shrink-0 text-right text-charcoal">
                      {reached} <span className="text-warm-grey">({Math.round((reached / onboardingFunnel.starts) * 100)}%)</span>
                    </div>
                    <div className="w-16 shrink-0 text-right text-xs text-warm-grey">
                      {skipped > 0 ? `${skipped} skip` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deterministic-reply radar: replies to pending bot questions that leaked to the classifier */}
      {pendingReplyLeaks && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Bot reply leaks (last {pendingReplyLeaks.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Replies to a pending bot question ("how long before?") that the deterministic layer
            couldn't read and handed to the classifier. Some are fine (the user changed the
            subject) - scan <strong>said</strong> for answers the parsers missed.
          </p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              ['Questions asked', pendingReplyLeaks.asked],
              ['Resolved deterministically', pendingReplyLeaks.resolved],
              ['Leaked to classifier', pendingReplyLeaks.leaks.length],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 text-center">
                <div className="text-2xl font-bold text-plum">{val}</div>
                <div className="text-xs text-warm-grey mt-1">{label}</div>
              </div>
            ))}
          </div>
          {pendingReplyLeaks.leaks.length > 0 && (
            <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-warm-grey">
                    <th className="pb-2 pr-4 font-medium">When</th>
                    <th className="pb-2 pr-4 font-medium">Flow</th>
                    <th className="pb-2 pr-4 font-medium">They said</th>
                    <th className="pb-2 font-medium">Became</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReplyLeaks.leaks.map((l, i) => (
                    <tr key={i} className="border-t border-light-grey">
                      <td className="py-2 pr-4 whitespace-nowrap text-warm-grey">{new Date(l.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                      <td className="py-2 pr-4">{l.flow}</td>
                      <td className="py-2 pr-4 text-charcoal">"{l.said}"</td>
                      <td className="py-2"><code className="text-xs">{l.became}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Referral loop: codes → referred families → activated → months granted */}
      {referrals && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Referrals (last {referrals.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Give a month, get a month. <strong>Activated</strong> is all-time (reward paid both
            sides); referred/pending/lapsed are within the window.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              ['Codes minted', referrals.codes],
              ['Families referred', referrals.referred],
              ['Still settling in', referrals.pending],
              ['Activated (all-time)', referrals.activated],
              ['Months granted', referrals.monthsGranted],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 text-center">
                <div className="text-2xl font-bold text-plum">{val}</div>
                <div className="text-xs text-warm-grey mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retention cohorts */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Retention by Cohort</h2>
        <p className="text-xs text-warm-grey mb-3">
          Each row is a weekly signup cohort. Cells show the % of that cohort active N weeks later
          ("active" = created any content during that week). Empty cells = cohort too new to measure.
        </p>
        <RetentionGrid retention={retention} />
      </div>

      {/* Channel cohorts: WhatsApp-only vs app */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Channel cohorts: WhatsApp-only vs app</h2>
        <p className="text-xs text-warm-grey mb-3">
          Households grouped by how their members actually use Housemait. <strong>App installed</strong> = at
          least one member registered the native iOS app; <strong>WhatsApp only</strong> = no app, but WhatsApp
          linked; <strong>Web only</strong> = neither. <strong>Conversion</strong> = of households past trial,
          the % subscribed. <strong>Retention</strong> = of households that ever subscribed, the % still active.
          Shows whether WhatsApp-primary households are worth more or less than app households.
        </p>
        <ChannelCohorts channelCohorts={channelCohorts} />
      </div>

      {/* Apple Ads - installs Apple attributed to a campaign, and whether
          they became real households. This is the "cost per activated
          household" half of the ads picture; spend lives in the Apple Ads
          console. Empty until app builds with the AdAttribution plugin ship. */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Apple Ads installs</h2>
        <p className="text-xs text-warm-grey mb-3">
          Users whose install Apple attributed to an ad tap, by campaign. <strong>WhatsApp linked</strong> and
          <strong> onboarded</strong> are the activation signals - divide campaign spend by these, not by
          installs. Organic installs are recorded but not shown. Collection starts with app builds that
          carry the attribution plugin.
        </p>
        <AppleAdsCard appleAds={appleAds} />
      </div>

      {/* DAU Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Daily Active Users</h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Active Users</th>
              </tr>
            </thead>
            <tbody>
              {dau.slice(-14).reverse().map((day) => (
                <tr key={day.date} className="border-b border-light-grey last:border-0">
                  <td className="px-4 py-3 text-charcoal">{day.date}</td>
                  <td className="px-4 py-3 text-right font-medium text-charcoal">{day.activeUsers}</td>
                </tr>
              ))}
              {dau.length === 0 && (
                <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No activity data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Activation & retention - lifetime per-household buckets + weekly curve.
   Self-fetching: the computation paginates several tables server-side (6h
   cache), so it loads lazily instead of riding the main /analytics call. */
const BUCKET_META = {
  active: { label: 'Active', chip: 'bg-sage-light text-sage' },
  fading: { label: 'Fading', chip: 'bg-amber-100 text-amber-700' },
  quiet: { label: 'Quiet', chip: 'bg-cream text-warm-grey' },
  petered_out: { label: 'Petered out', chip: 'bg-coral-light text-coral' },
  never_started: { label: 'Never started', chip: 'bg-light-grey text-warm-grey' },
  expired: { label: 'Expired', chip: 'bg-light-grey text-warm-grey' },
};

// "AI said no" radar: assistant replies (app chat + WhatsApp) where the model
// told a customer it couldn't do something. Each row is a potential capability
// gap - a missing action, or the model falsely denying a feature that exists.
function AiMisses() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(30);
  const [expanded, setExpanded] = useState(null);

  const fetchData = (d) =>
    api.get('/admin/ai-misses', { params: { days: d } })
      .then(({ data }) => { setData(data); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  useEffect(() => { fetchData(days); }, [days]);

  const byHousehold = {};
  for (const m of data?.misses || []) {
    (byHousehold[m.householdId] ||= { name: m.householdName, rows: [] }).rows.push(m);
  }
  const groups = Object.entries(byHousehold).sort((a, b) => b[1].rows.length - a[1].rows.length);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-medium text-charcoal">AI said no</h2>
        <div className="flex items-center gap-2">
          {[7, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => { setLoading(true); setDays(d); }}
              className={`text-xs font-semibold rounded-lg px-2 py-1 ${days === d ? 'bg-plum-light text-plum' : 'text-warm-grey hover:text-plum'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {failed && <p className="text-sm text-warm-grey bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">Couldn't load AI misses.</p>}
      {!failed && loading && !data && <div className="flex justify-center py-10"><Spinner /></div>}

      {data && !failed && (
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
          <p className="text-xs text-warm-grey mb-3">
            {data.misses.length} assistant replies said "I can't" across {groups.length} households.
            Each one is a capability gap or the model wrongly denying a feature that exists.
          </p>
          {groups.length === 0 && <p className="text-sm text-warm-grey">Nothing in this window. Lovely.</p>}
          {groups.map(([hid, g]) => (
            <div key={hid} className="border-b border-light-grey last:border-0 py-2">
              <button
                onClick={() => setExpanded(expanded === hid ? null : hid)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="text-sm font-medium text-charcoal">{g.name}</span>
                <span className="text-xs text-warm-grey">{g.rows.length} {g.rows.length === 1 ? 'reply' : 'replies'} {expanded === hid ? '▾' : '▸'}</span>
              </button>
              {expanded === hid && (
                <div className="mt-2 space-y-2">
                  {g.rows.map((m, i) => (
                    <div key={i} className="text-xs bg-cream rounded-lg p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${m.channel === 'whatsapp' ? 'bg-sage-light text-sage' : 'bg-plum-light text-plum'}`}>
                          {m.channel === 'whatsapp' ? 'WhatsApp' : 'App chat'}
                        </span>
                        <span className="text-warm-grey">{new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        {m.intent && <span className="text-warm-grey">intent: {m.intent}</span>}
                      </div>
                      <p className="text-charcoal admin-selectable">{m.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivationRetention() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // No synchronous setState in the effect: initial state already reads
  // loading=true/failed=false, and the refresh handler (a click, not an
  // effect) resets them itself.
  const fetchData = (refresh) =>
    api.get('/admin/activation', refresh ? { params: { refresh: 1 } } : undefined)
      .then(({ data }) => { setData(data); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  useEffect(() => { fetchData(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = (refresh) => { setLoading(true); setFailed(false); fetchData(refresh); };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-medium text-charcoal">Activation &amp; retention (lifetime)</h2>
        <button
          onClick={() => load(true)}
          className="text-xs font-semibold text-plum hover:underline disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {failed && <p className="text-sm text-warm-grey bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">Couldn't load activation data.</p>}
      {!failed && !data && <div className="flex justify-center py-10"><Spinner /></div>}

      {data && (
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
          {/* Bucket chips */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(BUCKET_META).map(([key, meta]) => (
              <span key={key} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${meta.chip}`}>
                {meta.label}
                <span className="font-bold">{data.buckets?.[key] ?? 0}</span>
              </span>
            ))}
            <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium text-warm-grey">
              of {data.totalHouseholds} genuine households
            </span>
          </div>

          {/* Weekly retention curve */}
          <p className="text-xs font-semibold text-warm-grey uppercase tracking-wider mt-5 mb-2">Any deliberate activity in week N since signup</p>
          <div className="flex items-end gap-2 h-24">
            {(data.weekly || []).map((w) => (
              <div key={w.week} className="flex flex-col items-center flex-1 min-w-0">
                <span className="text-[10px] text-warm-grey mb-1">{w.pct}%</span>
                <div className="w-full bg-plum-light rounded-t" style={{ height: `${Math.max(w.pct, 2)}%` }} />
                <span className="text-[10px] text-warm-grey mt-1">w{w.week}</span>
              </div>
            ))}
          </div>

          {/* Watchlist */}
          {(data.watchlist || []).length > 0 && (
            <>
              <p className="text-xs font-semibold text-warm-grey uppercase tracking-wider mt-5 mb-2">Watchlist — real usage that stopped or collapsed</p>
              <table className="w-full text-sm">
                <tbody>
                  {data.watchlist.map((h) => (
                    <tr key={h.id} className="border-b border-light-grey last:border-0">
                      <td className="py-2 pr-3 font-medium text-charcoal">{h.name}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${BUCKET_META[h.bucket]?.chip || ''}`}>
                          {BUCKET_META[h.bucket]?.label || h.bucket}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-warm-grey text-xs">first 14d: {h.first14} · last 14d: {h.last14}</td>
                      <td className="py-2 text-right text-warm-grey text-xs">
                        {h.lastActiveDays === null ? 'never active' : `active ${h.lastActiveDays}d ago`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <p className="text-[11px] text-warm-grey mt-3">Computed {new Date(data.computedAt).toLocaleString('en-GB')} · counts deliberate writes only (messages, lists, chores, to-dos, meals, manual events) · cached 6h</p>
        </div>
      )}
    </div>
  );
}

function FunnelStep({ label, value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-charcoal font-medium">{label}</span>
        <span className="text-warm-grey">{value} ({pct}%)</span>
      </div>
      <div className="h-2 bg-cream rounded-full overflow-hidden">
        <div className="h-full bg-plum rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CalendarConnection({ stats }) {
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-medium text-charcoal mb-1">Calendar connection</h2>
      <p className="text-sm text-warm-grey mb-3">
        The activation keystone — a household with a live calendar gets a populated dashboard, daily brief and reminders.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{fmtPct(stats?.connectedPct)}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">
            Households connected{stats ? ` (${stats.connected}/${stats.total})` : ''}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{fmtPct(stats?.activation7dPct)}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">
            Connected within 7 days{stats ? ` (${stats.activated7d}/${stats.eligible7d})` : ''}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{stats?.deviceConnected ?? '—'}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">via iPhone sync</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{stats?.urlConnected ?? '—'}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">via calendar link</p>
        </div>
      </div>
    </div>
  );
}

// Campaign ids from the Apple Ads console - names live only there, so the
// map is maintained by hand. Unknown ids (new campaigns) fall back to the id.
const APPLE_ADS_CAMPAIGNS = {
  2144260688: 'UK - Brand',
  2144260257: 'UK - Category',
  2144258775: 'UK - Competitor',
  2144259176: 'UK - Discovery',
};

function AppleAdsCard({ appleAds }) {
  if (!appleAds || appleAds.totalAttributed === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No attributed installs yet.</p>
      </div>
    );
  }
  const th = 'px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-light-grey text-left">
            <th className={th}>Campaign</th>
            <th className={`${th} text-right`}>Attributed users</th>
            <th className={`${th} text-right`}>WhatsApp linked</th>
            <th className={`${th} text-right`}>Onboarded</th>
            <th className={`${th} text-right`}>Redownloads</th>
          </tr>
        </thead>
        <tbody>
          {appleAds.campaigns.map((c) => (
            <tr key={c.campaignId} className="border-b border-light-grey last:border-0">
              <td className="px-4 py-3 font-medium text-charcoal">{APPLE_ADS_CAMPAIGNS[c.campaignId] || c.campaignId}</td>
              <td className="px-4 py-3 text-right font-semibold text-charcoal">{c.users}</td>
              <td className="px-4 py-3 text-right text-charcoal">{c.whatsappLinked}</td>
              <td className="px-4 py-3 text-right text-charcoal">{c.onboarded}</td>
              <td className="px-4 py-3 text-right text-warm-grey">{c.redownloads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COHORT_LABELS = { app: 'App installed', whatsapp_only: 'WhatsApp only', web_only: 'Web only' };
const COHORT_ORDER = ['app', 'whatsapp_only', 'web_only'];

function ChannelCohorts({ channelCohorts }) {
  if (!channelCohorts) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No cohort data yet.</p>
      </div>
    );
  }
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const th = 'px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-light-grey text-left">
            <th className={th}>Cohort</th>
            <th className={`${th} text-right`}>Households</th>
            <th className={`${th} text-right`}>Trialing</th>
            <th className={`${th} text-right`}>Active</th>
            <th className={`${th} text-right`}>Expired</th>
            <th className={`${th} text-right`}>Cancelled</th>
            <th className={`${th} text-right`}>Conversion</th>
            <th className={`${th} text-right`}>Retention</th>
          </tr>
        </thead>
        <tbody>
          {COHORT_ORDER.map((key) => {
            const c = channelCohorts[key];
            if (!c) return null;
            return (
              <tr key={key} className="border-b border-light-grey last:border-0">
                <td className="px-4 py-3 font-medium text-charcoal">{COHORT_LABELS[key]}</td>
                <td className="px-4 py-3 text-right text-charcoal">{c.total}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.trialing}</td>
                <td className="px-4 py-3 text-right text-charcoal">{c.active}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.expired}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.cancelled}</td>
                <td className="px-4 py-3 text-right font-semibold text-charcoal">{fmtPct(c.conversionPct)}</td>
                <td className="px-4 py-3 text-right font-semibold text-charcoal">{fmtPct(c.retentionPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Map a retention % to a tailwind background colour. Linear gradient from
// coral (low retention) through butter (mid) to sage (high). Cohort row
// header (the "100%" Week 0 cell) is always sage.
function retentionCellClass(pct) {
  if (pct === null || pct === undefined) return 'bg-cream text-warm-grey';
  if (pct >= 70) return 'bg-sage-light text-sage';
  if (pct >= 40) return 'bg-butter-light text-charcoal';
  if (pct > 0)   return 'bg-coral-light text-coral';
  return 'bg-cream text-warm-grey';
}

function formatCohortLabel(iso) {
  // iso is the Monday of the cohort week. Render as "13 Apr" — compact.
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function RetentionGrid({ retention }) {
  if (!retention || !retention.cohorts || retention.cohorts.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">Not enough cohort data yet — retention grid will populate as users sign up across more weeks.</p>
      </div>
    );
  }
  const { offsets, cohorts } = retention;

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-light-grey text-left">
            <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Cohort (Mon)</th>
            <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Size</th>
            {offsets.map((n) => (
              <th key={n} className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-center">
                W{n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.signupWeek} className="border-b border-light-grey last:border-0">
              <td className="px-4 py-3 font-medium text-charcoal">{formatCohortLabel(c.signupWeek)}</td>
              <td className="px-4 py-3 text-right text-warm-grey">{c.size}</td>
              {offsets.map((n) => {
                const pct = c.retention?.[n];
                const cell = retentionCellClass(pct);
                return (
                  <td key={n} className="px-2 py-2 text-center">
                    <span className={`inline-block w-full px-2 py-1 rounded-md text-xs font-semibold ${cell}`}>
                      {pct === null || pct === undefined ? '—' : `${pct}%`}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
