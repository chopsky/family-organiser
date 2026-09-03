import UIKit
import Capacitor

/**
 * App-local bridge view controller. Capacitor 5+ requires app-local plugins
 * to be registered explicitly in capacitorDidLoad (auto-discovery was
 * removed); Main.storyboard points at this class instead of the stock
 * CAPBridgeViewController.
 */
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EventKitReaderPlugin())
        bridge?.registerPluginInstance(AdAttributionPlugin())
        bridge?.registerPluginInstance(SiriBridgePlugin())
        // Widgets + Live Activity (1.14.0). Left out of this list in build
        // 45, every setToday() from the dashboard rejected silently and the
        // Today widget only ever showed "Open for today's plan".
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
