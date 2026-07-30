import Foundation
import Capacitor
#if canImport(AdServices)
import AdServices
#endif

/**
 * AdAttribution - hands the JS layer an Apple Ads attribution token.
 *
 * The token is generated on-device by the AdServices framework and redeemed
 * SERVER-side against Apple's attribution API; this plugin never learns
 * whether the install was attributed, and no permission prompt is involved -
 * token generation requires no ATT consent and needs no purpose string.
 *
 * Resolves with { token: String } when a token could be generated, and with
 * {} when it could not (iOS < 14.3, simulators, devices with no Apple Ads
 * activity - AAAttribution throws for those). "No token" is an expected
 * outcome, not an error, so the promise never rejects: the JS caller treats
 * an absent token as "nothing to report" and stays silent.
 */
@objc(AdAttributionPlugin)
public class AdAttributionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AdAttributionPlugin"
    public let jsName = "AdAttribution"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAttributionToken", returnType: CAPPluginReturnPromise),
    ]

    @objc func getAttributionToken(_ call: CAPPluginCall) {
        #if canImport(AdServices)
        if #available(iOS 14.3, *) {
            // Token generation can do main-thread work; keep the bridge snappy.
            DispatchQueue.global(qos: .utility).async {
                do {
                    let token = try AAAttribution.attributionToken()
                    call.resolve(["token": token])
                } catch {
                    call.resolve([:])
                }
            }
            return
        }
        #endif
        call.resolve([:])
    }
}
