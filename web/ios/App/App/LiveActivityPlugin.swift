import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 * LiveActivity - starts, updates and ends the "Next up" Live Activity
 * (NextUpLiveActivity.swift in the widget extension).
 *
 * One activity at a time, always the family's next event. The JS layer
 * (web/src/lib/liveActivity.js) decides WHEN - within the hour before an
 * event - and hands over the same fields the widgets use. Devices below
 * iOS 16.2 (the content-based ActivityKit API), or with Live Activities
 * switched off in Settings, resolve
 * `{ supported: false }` so the JS side can stay quiet.
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
    ]

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static func date(_ s: String?) -> Date? {
        guard let s = s else { return nil }
        return iso.date(from: s) ?? isoPlain.date(from: s)
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    /// Mirrors GRACE_MS in web/src/lib/liveActivity.js.
    static let graceAfterStart: TimeInterval = 10 * 60

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["supported": false]); return }
            guard let title = call.getString("title"), let start = LiveActivityPlugin.date(call.getString("start")) else {
                call.reject("title and start are required")
                return
            }
            let state = NextUpAttributes.ContentState(
                title: title,
                start: start,
                end: LiveActivityPlugin.date(call.getString("end")),
                location: call.getString("location"),
                color: call.getString("color") ?? "#6B3FA0",
                who: call.getString("who")
            )
            let attrs = NextUpAttributes(householdName: call.getString("householdName") ?? "Housemait")
            // One at a time: retire anything already showing before starting.
            Task {
                for a in Activity<NextUpAttributes>.activities {
                    await a.end(nil, dismissalPolicy: .immediate)
                }
                do {
                    // Stale ten minutes after the start: the countdown's job is
                    // done once the event has begun, and iOS can tidy the card
                    // even if the app never gets to say "end".
                    let stale = start.addingTimeInterval(LiveActivityPlugin.graceAfterStart)
                    let activity = try Activity<NextUpAttributes>.request(
                        attributes: attrs,
                        content: .init(state: state, staleDate: stale),
                        pushType: nil
                    )
                    call.resolve(["supported": true, "id": activity.id])
                } catch {
                    call.reject("Could not start Live Activity: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let title = call.getString("title"), let start = LiveActivityPlugin.date(call.getString("start")) else {
                call.reject("title and start are required")
                return
            }
            let state = NextUpAttributes.ContentState(
                title: title, start: start,
                end: LiveActivityPlugin.date(call.getString("end")),
                location: call.getString("location"),
                color: call.getString("color") ?? "#6B3FA0",
                who: call.getString("who")
            )
            Task {
                let stale = start.addingTimeInterval(LiveActivityPlugin.graceAfterStart)
                for a in Activity<NextUpAttributes>.activities {
                    await a.update(.init(state: state, staleDate: stale))
                }
                call.resolve(["supported": true, "updated": Activity<NextUpAttributes>.activities.count])
            }
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for a in Activity<NextUpAttributes>.activities {
                    await a.end(nil, dismissalPolicy: .immediate)
                }
                call.resolve(["supported": true])
            }
            return
        }
        #endif
        call.resolve(["supported": false])
    }
}
