import ActivityKit
import WidgetKit
import SwiftUI

// "Next up" Live Activity: the family's next event counting down on the
// Lock Screen and in the Dynamic Island. Started by the app when an event
// is within the hour (web/src/lib/liveActivity.js), updated as it moves,
// ended when the event finishes.

@available(iOS 16.1, *)
struct NextUpLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NextUpAttributes.self) { context in
            // Lock Screen / banner
            LockScreenView(state: context.state, household: context.attributes.householdName)
                .activityBackgroundTint(HMColor.cream)
                .activitySystemActionForegroundColor(HMColor.plum)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        Circle().fill(HMColor.hex(context.state.color)).frame(width: 10, height: 10)
                        Text(context.state.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: context.state).font(.system(size: 15, weight: .bold)).monospacedDigit().padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        if let who = context.state.who, !who.isEmpty { Text(who).font(.system(size: 12, weight: .medium)).foregroundColor(.secondary) }
                        if let loc = context.state.location, !loc.isEmpty { Text("· \(loc)").font(.system(size: 12)).foregroundColor(.secondary).lineLimit(1) }
                        Spacer()
                        Text(HMFormat.time.string(from: context.state.start)).font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Circle().fill(HMColor.hex(context.state.color)).frame(width: 10, height: 10).padding(.leading, 2)
            } compactTrailing: {
                Countdown(state: context.state).font(.system(size: 12, weight: .semibold)).monospacedDigit().frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "calendar").font(.system(size: 12, weight: .semibold)).foregroundColor(HMColor.hex(context.state.color))
            }
            .widgetURL(URL(string: "housemait://calendar"))
            .keylineTint(HMColor.plum)
        }
    }
}

@available(iOS 16.1, *)
private struct Countdown: View {
    let state: NextUpAttributes.ContentState
    var body: some View {
        let now = Date()
        if state.start > now {
            // Live, system-driven countdown - no timeline churn needed.
            Text(timerInterval: now...state.start, countsDown: true)
        } else if let end = state.end, end > now {
            Text("Now")
        } else {
            Text("Done")
        }
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let state: NextUpAttributes.ContentState
    let household: String
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: 3).fill(HMColor.hex(state.color)).frame(width: 5).padding(.vertical, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("NEXT UP").font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundColor(HMColor.plum)
                    Spacer()
                    Text(HMFormat.time.string(from: state.start)).font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundColor(HMColor.warmGrey)
                }
                Text(state.title).font(.system(size: 17, weight: .bold)).foregroundColor(HMColor.ink).lineLimit(1)
                HStack(spacing: 6) {
                    if let who = state.who, !who.isEmpty { Text(who) }
                    if let loc = state.location, !loc.isEmpty { Text("· \(loc)").lineLimit(1) }
                    Spacer()
                    Countdown(state: state).font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(HMColor.plum)
                }
                .font(.system(size: 12.5, weight: .medium)).foregroundColor(HMColor.warmGrey)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .widgetURL(URL(string: "housemait://calendar"))
    }
}
