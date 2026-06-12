/**
 * "Housemait never writes to your calendar" - enforced, not aspirational.
 *
 * iOS has no read-only calendar permission (EventKit "full access" includes
 * write capability), so the product guarantee rests on the app binary
 * containing no calendar-write code at all. This guard fails the whole test
 * suite if a write-capable EventKit symbol ever appears in the iOS sources -
 * whoever adds one has to consciously delete this test and explain why.
 */
const fs = require('fs');
const path = require('path');

const IOS_SRC = path.join(__dirname, '..', 'web', 'ios', 'App', 'App');

const FORBIDDEN = [
  /\.save\(/,                 // EKEventStore.save(_:span:commit:)
  /\.remove\(/,               // EKEventStore.remove(_:span:commit:)
  /\bcommit\(\)/,             // EKEventStore.commit()
  /requestWriteOnlyAccess/,   // write-only permission request
  /EKEvent\(eventStore:/,     // constructing a new calendar event
  /\.saveCalendar\(/,         // EKEventStore.saveCalendar
  /\.removeCalendar\(/,       // EKEventStore.removeCalendar
];

function swiftFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return swiftFiles(full);
    return entry.name.endsWith('.swift') ? [full] : [];
  });
}

describe('iOS sources contain no calendar-write code', () => {
  const files = swiftFiles(IOS_SRC);

  test('the EventKit bridge exists', () => {
    expect(files.some((f) => f.endsWith('EventKitReaderPlugin.swift'))).toBe(true);
  });

  test.each(files.map((f) => [path.relative(IOS_SRC, f), f]))(
    '%s has no write-capable EventKit symbols',
    (_rel, file) => {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(source).not.toMatch(pattern);
      }
    },
  );

  test('the bridge declares only the three read methods + openSettings', () => {
    const bridge = files.find((f) => f.endsWith('EventKitReaderPlugin.swift'));
    const source = fs.readFileSync(bridge, 'utf8');
    const declared = [...source.matchAll(/CAPPluginMethod\(name:\s*"(\w+)"/g)].map((m) => m[1]).sort();
    // The three EventKit methods are all read-only; openSettings only deep-links
    // to the OS Settings app (no EventKit access). Any OTHER new method must be
    // justified here - the FORBIDDEN write-symbol scan above is the real guard.
    expect(declared).toEqual(['fetchEvents', 'listCalendars', 'openSettings', 'requestAccess']);
  });
});
