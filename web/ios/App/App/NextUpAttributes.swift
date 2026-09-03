import Foundation
#if canImport(ActivityKit)
import ActivityKit

// Shared between the app (which starts/updates the activity from the
// LiveActivityPlugin) and the widget extension (which renders it). One
// activity at a time: the family's NEXT event, as a countdown on the
// Lock Screen and in the Dynamic Island.
@available(iOS 16.1, *)
struct NextUpAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var start: Date
        var end: Date?
        var location: String?
        var color: String   // member colour hex
        var who: String?
    }
    var householdName: String
}
#endif
