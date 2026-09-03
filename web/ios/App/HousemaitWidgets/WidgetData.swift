import Foundation
import SwiftUI

// The payload the app writes into the App Group whenever the dashboard
// digest loads (web/src/lib/widgetBridge.js). Today's events, already
// deduped and filtered the way the dashboard shows them, plus enough
// styling info (member colour, who) to draw a card without the app.

struct WidgetEvent: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let start: Date?
    let end: Date?
    let allDay: Bool
    let location: String?
    let color: String      // hex, the assigned member's colour (or plum)
    let who: String?       // "Mason" / "Mason & Logan" / nil
}

struct WidgetPayload: Codable {
    let generatedAt: Date
    let dateYmd: String
    let householdName: String?
    let events: [WidgetEvent]
}

enum WidgetStore {
    static let appGroup = "group.com.housemait.app"
    static let todayKey = "housemait.widget.today"

    /// JS writes ISO-8601 with fractional seconds; be lenient either way.
    static func decoder() -> JSONDecoder {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .custom { d in
            let s = try d.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorruptedError(in: try d.singleValueContainer(), debugDescription: "bad date \(s)")
        }
        return dec
    }

    static func load() -> WidgetPayload? {
        guard let s = UserDefaults(suiteName: appGroup)?.string(forKey: todayKey),
              let data = s.data(using: .utf8) else { return nil }
        return try? decoder().decode(WidgetPayload.self, from: data)
    }
}

// ── Brand tokens (the app's CSS custom properties, in SwiftUI) ──
enum HMColor {
    static let plum = Color(red: 0.420, green: 0.247, blue: 0.627)      // #6B3FA0
    static let plumLight = Color(red: 0.953, green: 0.929, blue: 0.988) // #F3EDFC
    static let cream = Color(red: 0.984, green: 0.973, blue: 0.953)     // #FBF8F3
    static let ink = Color(red: 0.176, green: 0.165, blue: 0.200)       // #2D2A33
    static let warmGrey = Color(red: 0.420, green: 0.404, blue: 0.455)  // #6B6774
    static let lightGrey = Color(red: 0.910, green: 0.898, blue: 0.925) // #E8E5EC
    static let coral = Color(red: 0.910, green: 0.447, blue: 0.290)     // #E8724A

    static func hex(_ s: String) -> Color {
        var h = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return plum }
        return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

// ── Formatting ──
enum HMFormat {
    static let time: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale.autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("HH:mm")
        return f
    }()
    static let weekday: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale.autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEEE d MMM")
        return f
    }()
    static func timeLabel(_ e: WidgetEvent) -> String {
        if e.allDay { return "All day" }
        guard let s = e.start else { return "" }
        return time.string(from: s)
    }
}

// iOS 17 wants containerBackground; iOS 16 wants a plain background.
extension View {
    @ViewBuilder
    func widgetSurface(_ color: Color = HMColor.cream) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }

    // Accessory (Lock Screen) families: the system paints the glass, but iOS 17
    // still refuses to render ANY family that hasn't declared a container
    // background - the gallery shows "Please adopt containerBackground API"
    // in its place. A clear container is the declaration.
    @ViewBuilder
    func lockSurface() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}

extension WidgetConfiguration {
    // The views carry their own 14pt padding (a match for the app's cards);
    // iOS 17's default content margins would stack another 16pt on top.
    func housemaitMargins() -> some WidgetConfiguration {
        self.contentMarginsDisabled()
    }
}
