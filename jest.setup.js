/**
 * Turn off HTTP keep-alive for the test process.
 *
 * Node 19 flipped `http.globalAgent.keepAlive` to true by default. Supertest
 * starts a FRESH ephemeral server for every `request(app())` and closes it when
 * the assertion finishes - so with keep-alive on, superagent pools a socket
 * against a port that is about to die, and a later request can be handed that
 * dead (or recycled) socket. The result is a response that never arrives
 * intact: usually "Parse Error: Expected HTTP/, RTSP/ or ICE/", occasionally a
 * body belonging to a different request entirely.
 *
 * It surfaced on 2026-07-28 as roughly one failure per five full runs, landing
 * on a different unrelated route test each time - Stripe webhooks, household
 * members, kids' notes, the Google-Calendar allowlist. Worker count made no
 * difference (it reproduced under --runInBand), which is what ruled out
 * parallelism and pointed at the socket pool.
 *
 * Connection pooling buys nothing here: every request in this suite goes to a
 * server that exists only for that request.
 */
const http = require('http');
const https = require('https');

http.globalAgent.keepAlive = false;
https.globalAgent.keepAlive = false;

/**
 * ── What was tried next, and did NOT work ──────────────────────────────────
 *
 * The obvious follow-up was to kill the listen/close churn itself: supertest
 * builds a fresh http.createServer() and listens on a new ephemeral port for
 * EVERY call (supertest/lib/test.js: `if (!addr) this._server = app.listen(0)`),
 * across ~305 call sites per run.
 *
 * Two changes were built and measured, then reverted:
 *   1. Mocking supertest here to hand it an already-listening server per app
 *      (it only ever closes a server it opened itself, so reuse is safe).
 *   2. Hoisting `const APP = app()` in the 13 files that called
 *      `request(app())`, so the reuse above could actually apply to them.
 *
 * Measured over 30 full runs each:
 *   before anything          ~20%  (3/15 serial, 1/8 and 2/12 parallel)
 *   keep-alive off            8%   (2/25)
 *   + server reuse           10%   (3/30)
 *   + reuse and hoisting      7%   (2/30)
 *
 * Everything after the keep-alive fix is one sample apart - at n=30 the
 * confidence interval on 7% spans roughly 1-22%, so there is no evidence any
 * of it helped. Server churn is therefore NOT the remaining cause, and both
 * changes were reverted rather than left in as complexity that doesn't pay:
 * a mocked test library and 109 rewritten call sites are a real maintenance
 * cost to carry for an unmeasurable gain.
 *
 * The residual ~8% is still unexplained. Whatever it is, it is not keep-alive
 * and not the number of listeners.
 */
