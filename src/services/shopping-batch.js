/**
 * Shopping check-off batching - one summary per shop, not one WhatsApp
 * per item.
 *
 * Live report (2026-08-31): a partner without the app received twelve
 * WhatsApp messages for a twelve-item shop, one per tick. Check-offs are
 * a burst activity; the notification worth sending is "the shop
 * happened, here's where the list stands" - once.
 *
 * Mechanics: each fresh check-off lands in a per-household buffer and
 * (re)starts a quiet-period timer. When no further ticks arrive for
 * QUIET_MS, ONE broadcast goes out: "✅ Sarah checked off 12 items
 * (milk, eggs, bread +9 more) · 3 left on the list". If a tick empties
 * the list, the summary goes immediately - "got everything" beats a
 * ten-minute wait when the shop is visibly done.
 *
 * Deliberately in-memory: a deploy mid-shop drops at most one summary,
 * which is strictly quieter than intended - nothing promised to the
 * user is lost (unlike pending-question state, which must never live in
 * a Map - see the evening-brief post-mortem). Un-checking an item while
 * the window is open retracts it from the pending summary.
 */

const broadcast = require('./broadcast');
const db = require('../db/queries');

const QUIET_MS = 10 * 60 * 1000;

// householdId -> { items: [names], senders: Map<id,name>, listId, timer }
const pending = new Map();

function fmtNames(senders) {
  const names = [...senders.values()];
  if (names.length <= 1) return names[0] || 'Someone';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} & others`;
}

function fmtItems(items) {
  const shown = items.slice(0, 3).join(', ');
  const extra = items.length > 3 ? ` +${items.length - 3} more` : '';
  return `(${shown}${extra})`;
}

async function flush(householdId) {
  const entry = pending.get(householdId);
  pending.delete(householdId);
  if (!entry || entry.items.length === 0) return;
  clearTimeout(entry.timer);

  const n = entry.items.length;
  let remaining = null;
  try {
    remaining = await db.countOpenShoppingItems(householdId, entry.listId);
  } catch { /* count is garnish - the summary still goes */ }

  const who = fmtNames(entry.senders);
  const tail = remaining === 0
    ? ' - list done 🎉'
    : remaining > 0
      ? ` · ${remaining} left on the list`
      : '';
  const message = n === 1
    ? `✅ ${who} checked off: ${entry.items[0]}${tail}`
    : `✅ ${who} checked off ${n} items ${fmtItems(entry.items)}${tail}`;

  try {
    const members = await db.getHouseholdMembers(householdId);
    // broadcast skips one sender; with co-shoppers the first ticker is
    // the skip - a co-shopper receiving the household summary is
    // harmless, twelve pings was the problem.
    const [primarySender] = entry.senders.keys();
    broadcast.toHousehold(primarySender, members, message, {
      title: 'Shopping list', category: 'shopping_updated',
    });
  } catch (err) {
    console.error('[shopping-batch] flush failed:', err.message);
  }
}

/** A fresh check-off (open -> completed transition only). */
function noteCheckOff({ householdId, senderId, senderName, itemName, listId }) {
  let entry = pending.get(householdId);
  if (!entry) {
    entry = { items: [], senders: new Map(), listId, timer: null };
    pending.set(householdId, entry);
  }
  entry.items.push(itemName);
  entry.senders.set(senderId, senderName);
  entry.listId = listId ?? entry.listId;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { flush(householdId).catch(() => {}); }, QUIET_MS);
  if (entry.timer.unref) entry.timer.unref();

  // The list just emptied: the shop is visibly over - summarise now.
  db.countOpenShoppingItems(householdId, entry.listId)
    .then((remaining) => { if (remaining === 0) return flush(householdId); return undefined; })
    .catch(() => { /* stay on the quiet-window timer */ });
}

/** An un-check during the window: take it back out of the summary. */
function retractCheckOff(householdId, itemName) {
  const entry = pending.get(householdId);
  if (!entry) return;
  const i = entry.items.indexOf(itemName);
  if (i >= 0) entry.items.splice(i, 1);
  if (entry.items.length === 0) {
    clearTimeout(entry.timer);
    pending.delete(householdId);
  }
}

/** Test hook. */
function _reset() {
  for (const [, e] of pending) clearTimeout(e.timer);
  pending.clear();
}

module.exports = { noteCheckOff, retractCheckOff, flush, _reset, QUIET_MS };
