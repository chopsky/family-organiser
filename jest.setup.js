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
