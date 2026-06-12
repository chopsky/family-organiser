import Foundation
import Capacitor
import EventKit

/**
 * EventKitReader - a deliberately READ-ONLY bridge to the device calendar.
 *
 * Housemait's product guarantee is "we never write to your calendar". iOS has
 * no read-only calendar permission (full access technically includes write
 * capability), so the guarantee is enforced by construction instead:
 *
 *   - This plugin exposes exactly three methods: requestAccess,
 *     listCalendars, fetchEvents. There is NO save/remove/commit path,
 *     no EKEvent construction, and no other EventKit code in the app.
 *   - A jest guard (src/ios-no-calendar-write.test.js) fails the suite if a
 *     calendar-write symbol ever appears in the iOS sources.
 *
 * Recurring events are returned as EventKit's own expanded occurrences -
 * each occurrence carries the series' stable external identifier plus its
 * occurrence start, so the server can dedupe across devices.
 */
@objc(EventKitReaderPlugin)
public class EventKitReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EventKitReaderPlugin"
    public let jsName = "EventKitReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listCalendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchEvents", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    @objc func requestAccess(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents { granted, _ in
                call.resolve(["granted": granted])
            }
        } else {
            store.requestAccess(to: .event) { granted, _ in
                call.resolve(["granted": granted])
            }
        }
    }

    @objc func listCalendars(_ call: CAPPluginCall) {
        let calendars = store.calendars(for: .event).map { cal -> [String: Any] in
            [
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "type": typeName(cal.type),
                "color": hexString(cal.cgColor),
                "sourceTitle": cal.source?.title ?? "",
            ]
        }
        call.resolve(["calendars": calendars])
    }

    @objc func fetchEvents(_ call: CAPPluginCall) {
        guard let calendarIds = call.getArray("calendarIds", String.self), !calendarIds.isEmpty,
              let startMs = call.getDouble("start"),
              let endMs = call.getDouble("end") else {
            call.reject("calendarIds, start and end are required")
            return
        }
        let wanted = Set(calendarIds)
        let cals = store.calendars(for: .event).filter { wanted.contains($0.calendarIdentifier) }
        guard !cals.isEmpty else {
            call.resolve(["events": []])
            return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        // NB: EventKit caps a single predicate at a 4-year span; the app's
        // sync window (3 years) stays inside it.
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: cals)
        let iso = ISO8601DateFormatter()
        let events = store.events(matching: predicate).compactMap { ev -> [String: Any]? in
            guard let startDate = ev.startDate else { return nil }
            let seriesId = ev.calendarItemExternalIdentifier ?? ev.eventIdentifier ?? ""
            guard !seriesId.isEmpty else { return nil }
            return [
                "calendarId": ev.calendar.calendarIdentifier,
                "uid": seriesId + "#" + iso.string(from: startDate),
                "title": ev.title ?? "",
                "start": iso.string(from: startDate),
                "end": iso.string(from: ev.endDate ?? startDate),
                "allDay": ev.isAllDay,
                "location": ev.location ?? "",
                "isRecurring": ev.hasRecurrenceRules,
            ]
        }
        call.resolve(["events": events])
    }

    private func typeName(_ type: EKCalendarType) -> String {
        switch type {
        case .local: return "local"
        case .calDAV: return "caldav"
        case .exchange: return "exchange"
        case .subscription: return "subscription"
        case .birthday: return "birthday"
        @unknown default: return "other"
        }
    }

    private func hexString(_ color: CGColor?) -> String {
        guard let color = color, let comps = color.components, comps.count >= 3 else { return "" }
        let r = Int(round(comps[0] * 255)), g = Int(round(comps[1] * 255)), b = Int(round(comps[2] * 255))
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
