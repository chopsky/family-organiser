/*
 HousemaitCalendarPlugin
 -----------------------

 Reads events from the device's Calendar app (Apple, Google, Outlook,
 iCloud — anything the user has set up via iOS Settings → Calendar →
 Accounts) so Housemait can render them inline alongside household
 events. Read-only; we never write to the system store.

 Why a custom plugin: the existing Capacitor calendar plugins on npm
 are stale (they still call the iOS 16- requestAccess API which is
 deprecated as of iOS 17), and our needs are narrow enough that a slim
 in-tree plugin is easier to maintain than a vendored dependency.

 Capacitor 8 in-tree plugin pattern: conform to CAPBridgedPlugin and
 declare identifier / jsName / pluginMethods. This is the modern
 registration path — the old CAP_PLUGIN macro from a .m sidecar file
 only works for plugins shipped as SPM/Cocoapod packages, not for
 plugins living inside the App target. Pure Swift here.

 iOS 17+ split EKEventStore authorisation into fullAccess (read+write)
 and writeOnly. We need read, so we request full access. The legacy
 path for iOS 16 falls back to requestAccess(to:) which the framework
 still honours.

 JS-side identifier (what registerPlugin() uses): "HousemaitCalendar"
 */

import Foundation
import Capacitor
import EventKit

@objc(HousemaitCalendarPlugin)
public class HousemaitCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    // CAPBridgedPlugin requirements — these expose the plugin to the
    // Capacitor 8 bridge without needing a .m sidecar file. The
    // jsName must match what registerPlugin('…') uses in JS.
    public let identifier = "HousemaitCalendarPlugin"
    public let jsName = "HousemaitCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAuthorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listCalendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEvents", returnType: CAPPluginReturnPromise),
    ]

    private let eventStore = EKEventStore()
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    // MARK: Authorisation

    @objc func getAuthorizationStatus(_ call: CAPPluginCall) {
        call.resolve(["status": currentStatusString()])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToEvents { granted, error in
                DispatchQueue.main.async {
                    if let error = error {
                        call.reject("Permission request failed: \(error.localizedDescription)")
                        return
                    }
                    call.resolve(["status": granted ? "granted" : "denied"])
                }
            }
        } else {
            // iOS 16 and earlier — legacy API. Deprecated on iOS 17+
            // but still functional; suppress the warning so this file
            // doesn't get flagged on every build.
            eventStore.requestAccess(to: .event) { granted, error in
                DispatchQueue.main.async {
                    if let error = error {
                        call.reject("Permission request failed: \(error.localizedDescription)")
                        return
                    }
                    call.resolve(["status": granted ? "granted" : "denied"])
                }
            }
        }
    }

    /// Map EKAuthorizationStatus to one of the four strings the JS
    /// side understands. 'writeOnly' (iOS 17) is treated as 'denied'
    /// for our purposes since we only render — we never write.
    private func currentStatusString() -> String {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            switch status {
            case .fullAccess: return "granted"
            case .writeOnly: return "denied" // we don't need write
            case .denied, .restricted: return "denied"
            case .notDetermined: return "not_determined"
            case .authorized: return "granted" // pre-17 carry-over
            @unknown default: return "not_determined"
            }
        } else {
            switch status {
            case .authorized: return "granted"
            case .denied, .restricted: return "denied"
            case .notDetermined: return "not_determined"
            @unknown default: return "not_determined"
            }
        }
    }

    // MARK: Listing calendars

    @objc func listCalendars(_ call: CAPPluginCall) {
        guard currentStatusString() == "granted" else {
            call.reject("Calendar access not granted")
            return
        }
        let cals = eventStore.calendars(for: .event)
        let payload: [[String: Any]] = cals.map { cal in
            [
                "id": cal.calendarIdentifier,
                "name": cal.title,
                "type": sourceTitle(for: cal),
                "color": hexFromCGColor(cal.cgColor),
                "allowsContentModifications": cal.allowsContentModifications,
            ]
        }
        call.resolve(["calendars": payload])
    }

    private func sourceTitle(for cal: EKCalendar) -> String {
        // EKSource.title is what the user sees in iOS Settings —
        // "iCloud", "Google", "Exchange", "Subscribed", "Birthdays".
        return cal.source.title
    }

    private func hexFromCGColor(_ cg: CGColor) -> String {
        let comps = cg.components ?? [0, 0, 0, 1]
        let r = Int((comps.count > 0 ? comps[0] : 0) * 255)
        let g = Int((comps.count > 1 ? comps[1] : 0) * 255)
        let b = Int((comps.count > 2 ? comps[2] : 0) * 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }

    // MARK: Fetching events

    @objc func getEvents(_ call: CAPPluginCall) {
        guard currentStatusString() == "granted" else {
            call.reject("Calendar access not granted")
            return
        }
        guard let startStr = call.getString("start"),
              let endStr = call.getString("end"),
              let start = isoFormatter.date(from: startStr) ?? fallbackParse(startStr),
              let end = isoFormatter.date(from: endStr) ?? fallbackParse(endStr) else {
            call.reject("start and end ISO-8601 dates required")
            return
        }
        // Optional: filter to a subset of calendar IDs. If empty/nil,
        // include all calendars the user can see.
        let calendarIds = call.getArray("calendarIds", String.self) ?? []
        let allCalendars = eventStore.calendars(for: .event)
        let calendars: [EKCalendar]
        if calendarIds.isEmpty {
            calendars = allCalendars
        } else {
            let set = Set(calendarIds)
            calendars = allCalendars.filter { set.contains($0.calendarIdentifier) }
        }
        if calendars.isEmpty {
            call.resolve(["events": []])
            return
        }
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = eventStore.events(matching: predicate)
        let payload: [[String: Any]] = events.map { event in
            var dict: [String: Any] = [
                "id": event.eventIdentifier ?? UUID().uuidString,
                "title": event.title ?? "",
                "startISO": isoFormatter.string(from: event.startDate),
                "endISO": isoFormatter.string(from: event.endDate),
                "allDay": event.isAllDay,
                "calendarId": event.calendar.calendarIdentifier,
                "calendarName": event.calendar.title,
                "calendarColor": hexFromCGColor(event.calendar.cgColor),
            ]
            if let location = event.location, !location.isEmpty {
                dict["location"] = location
            }
            if let notes = event.notes, !notes.isEmpty {
                dict["notes"] = notes
            }
            return dict
        }
        call.resolve(["events": payload])
    }

    private func fallbackParse(_ s: String) -> Date? {
        // Some JS callers may pass a plain "YYYY-MM-DD" — accept that
        // as start-of-day local time. Anything else returns nil.
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        return f.date(from: s)
    }
}
