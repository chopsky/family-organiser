import Foundation
import AppIntents

/**
 * "Hey Siri, add to Housemait" - App Intents shopping-list add.
 *
 * Zero-setup App Shortcut (iOS 16+): installing the app registers the
 * phrases below with Siri automatically. Free-form text can't be embedded
 * in a shortcut phrase (Apple limits phrase parameters to enums/entities),
 * so the flow is two-step: the user invokes the shortcut, Siri asks
 * "What should I add?", the user dictates ("milk and eggs"), and the
 * intent posts the items to the API in the background - the app never
 * opens. Works from iPhone, AirPods, CarPlay, and HomePod personal
 * requests.
 *
 * Auth: a long-lived scope:'siri' token mirrored into UserDefaults by
 * SiriBridgePlugin (the JS layer mints it weekly post-sign-in). The token
 * can ONLY add shopping items - the backend rejects it everywhere else -
 * so a signed-out or never-signed-in state just yields a polite dialog.
 *
 * The API base is the production host: native builds always talk to
 * production (matches web/.env.production), and an intent has no access
 * to the JS layer's config to learn anything else.
 */
@available(iOS 16.0, *)
struct AddToShoppingListIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Shopping List"
    static var description = IntentDescription("Add items to your family's Housemait shopping list.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Items", requestValueDialog: "What should I add to the shopping list?")
    var items: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$items) to the shopping list")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let token = UserDefaults.standard.string(forKey: "housemait.siri.apiToken"), !token.isEmpty else {
            return .result(dialog: "Open Housemait and sign in first, then try again.")
        }

        // "milk, eggs and bread" -> ["milk", "eggs", "bread"]. Deterministic
        // split keeps Siri fast and predictable; the API's dedupe + aisle
        // detection handle the rest server-side.
        let names = items
            .replacingOccurrences(of: " and ", with: ",", options: .caseInsensitive)
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !names.isEmpty else {
            return .result(dialog: "I didn't catch anything to add.")
        }

        var request = URLRequest(url: URL(string: "https://api.housemait.com/api/shopping")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "items": names.map { ["item": $0] },
        ])

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            switch status {
            case 200...299:
                let summary = names.count == 1 ? names[0] : "\(names.count) items"
                return .result(dialog: "Added \(summary) to your shopping list.")
            case 401:
                return .result(dialog: "Open Housemait and sign in again, then try once more.")
            case 402:
                return .result(dialog: "Your Housemait subscription needs attention - open the app to sort it out.")
            default:
                return .result(dialog: "I couldn't add that just now. Try again in a moment.")
            }
        } catch {
            return .result(dialog: "I couldn't reach Housemait. Check your connection and try again.")
        }
    }
}

@available(iOS 16.0, *)
struct HousemaitShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToShoppingListIntent(),
            phrases: [
                "Add to \(.applicationName)",
                "Add to my \(.applicationName) shopping list",
                "Add to the \(.applicationName) shopping list",
                "Add something to \(.applicationName)",
            ],
            shortTitle: "Add to shopping list",
            systemImageName: "cart.badge.plus"
        )
    }
}
