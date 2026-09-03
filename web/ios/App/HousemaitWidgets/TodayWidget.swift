import WidgetKit
import SwiftUI

// "Today" - the family's day on the home screen. Small: the next event.
// Medium: the next event plus what follows. Lock screen: one line.
// Data comes from the App Group (see WidgetData.swift); the timeline
// re-renders at every event start so "next" always means next.

struct TodayEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload?

    var events: [WidgetEvent] { payload?.events ?? [] }
    var timed: [WidgetEvent] { events.filter { !$0.allDay && $0.start != nil } }
    var allDay: [WidgetEvent] { events.filter { $0.allDay } }
    /// Timed events that haven't finished yet, soonest first.
    var upcoming: [WidgetEvent] {
        timed.filter { ($0.end ?? $0.start ?? date) >= date }.sorted { ($0.start ?? date) < ($1.start ?? date) }
    }
    var next: WidgetEvent? { upcoming.first }
    var isStale: Bool {
        guard let p = payload else { return true }
        // The app writes at least once a day; a payload for another day is old news.
        return p.dateYmd != TodayProvider.ymd(date)
    }
}

struct TodayProvider: TimelineProvider {
    static func ymd(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: d)
    }

    func placeholder(in context: Context) -> TodayEntry {
        let now = Date()
        let sample = WidgetPayload(generatedAt: now, dateYmd: TodayProvider.ymd(now), householdName: "The Shapiros", events: [
            WidgetEvent(id: "1", title: "School pickup", start: now.addingTimeInterval(1800), end: now.addingTimeInterval(3600), allDay: false, location: "Maplewood Primary", color: "#6B3FA0", who: "Mason"),
            WidgetEvent(id: "2", title: "Swimming", start: now.addingTimeInterval(7200), end: now.addingTimeInterval(9000), allDay: false, location: nil, color: "#7DAE82", who: "Logan"),
            WidgetEvent(id: "3", title: "Dinner with the Blochs", start: now.addingTimeInterval(14400), end: nil, allDay: false, location: nil, color: "#E0A458", who: nil),
        ])
        return TodayEntry(date: now, payload: sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        completion(TodayEntry(date: Date(), payload: WidgetStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let now = Date()
        let payload = WidgetStore.load()
        var dates: [Date] = [now]
        // One entry per upcoming boundary (starts AND ends), so the card
        // flips exactly when the day moves on - not on a polling interval.
        for e in payload?.events ?? [] where !e.allDay {
            for d in [e.start, e.end].compactMap({ $0 }) where d > now { dates.append(d.addingTimeInterval(1)) }
        }
        // And a midnight entry so a stale "today" turns into an honest
        // "open the app" instead of yesterday's schedule.
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            dates.append(midnight.addingTimeInterval(1))
        }
        let entries = Array(Set(dates)).sorted().map { TodayEntry(date: $0, payload: payload) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

// ── Views ──

private struct EventRow: View {
    let event: WidgetEvent
    var compact = false
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            RoundedRectangle(cornerRadius: 2).fill(HMColor.hex(event.color)).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title).font(.system(size: compact ? 12.5 : 13.5, weight: .semibold)).foregroundColor(HMColor.ink).lineLimit(1)
                HStack(spacing: 4) {
                    Text(HMFormat.timeLabel(event)).monospacedDigit()
                    if let who = event.who, !who.isEmpty { Text("·"); Text(who).lineLimit(1) }
                }
                .font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct Header: View {
    let entry: TodayEntry
    var body: some View {
        HStack {
            Text("TODAY").font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundColor(HMColor.plum)
            Spacer()
            Text(HMFormat.weekday.string(from: entry.date)).font(.system(size: 10, weight: .semibold)).foregroundColor(HMColor.warmGrey)
        }
    }
}

private struct EmptyLine: View {
    let entry: TodayEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if entry.isStale {
                Text("Open Housemait").font(.system(size: 15, weight: .semibold)).foregroundColor(HMColor.ink)
                Text("for today's plan").font(.system(size: 12)).foregroundColor(HMColor.warmGrey)
            } else if entry.timed.isEmpty && entry.allDay.isEmpty {
                Text("Nothing on today").font(.system(size: 15, weight: .semibold)).foregroundColor(HMColor.ink)
                Text("Enjoy the quiet").font(.system(size: 12)).foregroundColor(HMColor.warmGrey)
            } else {
                Text("That's everything").font(.system(size: 15, weight: .semibold)).foregroundColor(HMColor.ink)
                Text("Nothing else today").font(.system(size: 12)).foregroundColor(HMColor.warmGrey)
            }
        }
    }
}

struct TodaySmallView: View {
    let entry: TodayEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Header(entry: entry)
            Spacer(minLength: 0)
            if let next = entry.next, !entry.isStale {
                Text(HMFormat.timeLabel(next)).font(.system(size: 22, weight: .bold)).monospacedDigit().foregroundColor(HMColor.hex(next.color))
                Text(next.title).font(.system(size: 14, weight: .semibold)).foregroundColor(HMColor.ink).lineLimit(2)
                if let who = next.who, !who.isEmpty {
                    Text(who).font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(1)
                } else if let loc = next.location, !loc.isEmpty {
                    Text(loc).font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(1)
                }
                let more = entry.upcoming.count - 1
                if more > 0 {
                    Text("+\(more) more today").font(.system(size: 10.5, weight: .semibold)).foregroundColor(HMColor.plum).padding(.top, 2)
                }
            } else {
                EmptyLine(entry: entry)
            }
        }
        .padding(14)
        .widgetSurface()
        .widgetURL(URL(string: "housemait://calendar"))
    }
}

struct TodayMediumView: View {
    let entry: TodayEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(entry: entry)
            if let next = entry.next, !entry.isStale {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NEXT").font(.system(size: 9.5, weight: .bold)).tracking(0.6).foregroundColor(HMColor.warmGrey)
                        Text(HMFormat.timeLabel(next)).font(.system(size: 24, weight: .bold)).monospacedDigit().foregroundColor(HMColor.hex(next.color))
                        Text(next.title).font(.system(size: 14, weight: .semibold)).foregroundColor(HMColor.ink).lineLimit(2)
                        if let who = next.who, !who.isEmpty {
                            Text(who).font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(1)
                        } else if let loc = next.location, !loc.isEmpty {
                            Text(loc).font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    let rest = Array(entry.upcoming.dropFirst().prefix(3))
                    VStack(alignment: .leading, spacing: 7) {
                        if rest.isEmpty {
                            Text("Nothing else today").font(.system(size: 12, weight: .medium)).foregroundColor(HMColor.warmGrey)
                        } else {
                            ForEach(rest) { EventRow(event: $0, compact: true) }
                            let extra = entry.upcoming.count - 1 - rest.count
                            if extra > 0 { Text("+\(extra) more").font(.system(size: 10.5, weight: .semibold)).foregroundColor(HMColor.plum) }
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Spacer(minLength: 0)
                EmptyLine(entry: entry)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .widgetSurface()
        .widgetURL(URL(string: "housemait://calendar"))
    }
}

struct TodayLockView: View {
    let entry: TodayEntry
    var body: some View {
        // The system's frosted pill behind the text (the same glass the
        // Calendar and Mail circles sit on), so the card reads over any
        // wallpaper. Without it the lines sat straight on the photo.
        ZStack {
            // The pill's own rounding on the rectangular family is slight;
            // clip it to the continuous rounded rectangle other Lock Screen
            // cards use so it reads as a card, not a box.
            AccessoryWidgetBackground()
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                if let next = entry.next, !entry.isStale {
                    Text("Next · \(HMFormat.timeLabel(next))").font(.system(size: 12, weight: .semibold))
                    Text(next.title).font(.system(size: 13, weight: .bold)).lineLimit(1)
                    if let who = next.who, !who.isEmpty { Text(who).font(.system(size: 11)).lineLimit(1) }
                } else {
                    Text("Housemait").font(.system(size: 12, weight: .semibold))
                    Text(entry.isStale ? "Open for today's plan" : "Nothing else today").font(.system(size: 12)).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .lockSurface()
        .widgetURL(URL(string: "housemait://calendar"))
    }
}

/// The one-line family above the clock: "18:30 Swimming · Mason".
struct TodayInlineView: View {
    let entry: TodayEntry
    var body: some View {
        Group {
            if let next = entry.next, !entry.isStale {
                Text("\(HMFormat.timeLabel(next)) \(next.title)\(next.who.map { " · \($0)" } ?? "")")
            } else {
                Text(entry.isStale ? "Housemait · open for today" : "Housemait · nothing else today")
            }
        }
        .lockSurface()
        .widgetURL(URL(string: "housemait://calendar"))
    }
}

struct TodayWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    var body: some View {
        switch family {
        case .systemMedium: TodayMediumView(entry: entry)
        case .accessoryRectangular: TodayLockView(entry: entry)
        case .accessoryInline: TodayInlineView(entry: entry)
        default: TodaySmallView(entry: entry)
        }
    }
}

struct TodayWidget: Widget {
    let kind = "HousemaitToday"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            TodayWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("What's next for the family, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
        .housemaitMargins()
    }
}
