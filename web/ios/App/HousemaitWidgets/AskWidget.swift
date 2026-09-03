import WidgetKit
import SwiftUI

// "Ask Housemait" - a launcher that looks like the app's composer. Widgets
// can't take text input (Apple allows buttons/toggles only), so the whole
// widget opens the chat with the keyboard up, and the mic opens it in
// voice mode. Static: no data, never stale.

struct AskEntry: TimelineEntry { let date: Date }

struct AskProvider: TimelineProvider {
    func placeholder(in context: Context) -> AskEntry { AskEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (AskEntry) -> Void) { completion(AskEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AskEntry>) -> Void) {
        completion(Timeline(entries: [AskEntry(date: Date())], policy: .never))
    }
}

private struct Sparkle: View {
    var size: CGFloat = 18
    var body: some View {
        Image(systemName: "sparkles").font(.system(size: size, weight: .semibold)).foregroundColor(.white)
    }
}

struct AskSmallView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                Circle().fill(LinearGradient(colors: [HMColor.plum, Color(red: 0.557, green: 0.373, blue: 1.0)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Sparkle(size: 18)
            }
            .frame(width: 40, height: 40)
            Spacer(minLength: 0)
            Text("Ask Housemait").font(.system(size: 15, weight: .bold)).foregroundColor(HMColor.ink)
            Text("Add to the list, plan dinner, check what's on…").font(.system(size: 11, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetSurface()
        .widgetURL(URL(string: "housemait://chat"))
    }
}

struct AskMediumView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(LinearGradient(colors: [HMColor.plum, Color(red: 0.557, green: 0.373, blue: 1.0)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Sparkle(size: 13)
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Housemait AI").font(.system(size: 13.5, weight: .bold)).foregroundColor(HMColor.ink)
                    Text("Knows your family · always on").font(.system(size: 10.5, weight: .medium)).foregroundColor(HMColor.warmGrey)
                }
                Spacer()
            }
            Spacer(minLength: 0)
            // The composer bar. Tapping the bar types; tapping the mic talks.
            HStack(spacing: 10) {
                Link(destination: URL(string: "housemait://chat")!) {
                    HStack {
                        Text("Ask Housemait anything…").font(.system(size: 14, weight: .medium)).foregroundColor(HMColor.warmGrey).lineLimit(1)
                        Spacer()
                    }
                    .padding(.horizontal, 14).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 22).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 22).stroke(HMColor.lightGrey, lineWidth: 1.5))
                }
                Link(destination: URL(string: "housemait://chat?voice=1")!) {
                    ZStack {
                        Circle().fill(HMColor.plum)
                        Image(systemName: "mic.fill").font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                    }
                    .frame(width: 44, height: 44)
                }
            }
        }
        .padding(14)
        .widgetSurface()
        .widgetURL(URL(string: "housemait://chat"))
    }
}

struct AskWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: AskEntry
    var body: some View {
        switch family {
        case .systemMedium: AskMediumView()
        default: AskSmallView()
        }
    }
}

struct AskWidget: Widget {
    let kind = "HousemaitAsk"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AskProvider()) { entry in
            AskWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Ask Housemait")
        .description("One tap to type or talk to your family assistant.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .housemaitMargins()
    }
}
