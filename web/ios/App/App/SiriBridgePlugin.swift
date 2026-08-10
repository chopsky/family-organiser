import Foundation
import Capacitor

/**
 * SiriBridge - hands the Siri App Intent its API credential.
 *
 * The App Intent (see ShoppingIntents.swift) runs outside the WebView, so
 * it can't read the JS layer's localStorage. Instead the JS layer mints a
 * long-lived scope:'siri' token from the backend (weekly, post-sign-in)
 * and mirrors it here into UserDefaults, where the intent can read it.
 *
 * The token is scope-limited server-side: it can add shopping items and
 * nothing else, which is why UserDefaults (not the Keychain) is an
 * acceptable home for it.
 */
@objc(SiriBridgePlugin)
public class SiriBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SiriBridgePlugin"
    public let jsName = "SiriBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
    ]

    static let tokenKey = "housemait.siri.apiToken"

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        UserDefaults.standard.set(token, forKey: SiriBridgePlugin.tokenKey)
        call.resolve()
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: SiriBridgePlugin.tokenKey)
        call.resolve()
    }
}
