/*
 MainViewController
 ------------------

 Custom CAPBridgeViewController subclass that explicitly registers
 in-tree native plugins. Capacitor 7/8 with SPM only auto-discovers
 plugins shipped as Swift packages (everything under CapApp-SPM in
 this project — push, social-login, app-shortcuts, etc.). Plugins
 living inside the App target — like HousemaitCalendarPlugin —
 must be hand-registered or the JS bridge silently fails to find
 them and every call from the web layer returns an error.

 If we add more in-tree native plugins later, register them here
 alongside HousemaitCalendarPlugin.

 Wired in via Main.storyboard — the customClass on the root view
 controller points to this class instead of CAPBridgeViewController.
 */

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HousemaitCalendarPlugin())
    }
}
