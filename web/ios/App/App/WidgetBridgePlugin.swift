import Foundation
import Capacitor
import WidgetKit

/**
 * WidgetBridge - hands the home-screen widgets their data.
 *
 * The widget extension runs outside the WebView and can't call the API,
 * so the JS layer (web/src/lib/widgetBridge.js) serialises today's
 * events whenever the dashboard digest loads and drops the JSON into the
 * shared App Group. Writing it also asks WidgetKit to re-render, so the
 * home screen updates the moment the app knows something new.
 *
 * Nothing sensitive lives here beyond event titles the user already sees
 * on their lock screen in notifications; the App Group is sandboxed to
 * this app's own bundles.
 */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToday", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.com.housemait.app"
    static let todayKey = "housemait.widget.today"

    @objc func setToday(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), !json.isEmpty else {
            call.reject("json is required")
            return
        }
        guard let defaults = UserDefaults(suiteName: WidgetBridgePlugin.appGroup) else {
            call.reject("App Group unavailable")
            return
        }
        defaults.set(json, forKey: WidgetBridgePlugin.todayKey)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: WidgetBridgePlugin.appGroup)?.removeObject(forKey: WidgetBridgePlugin.todayKey)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
