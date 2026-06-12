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
    }
}
