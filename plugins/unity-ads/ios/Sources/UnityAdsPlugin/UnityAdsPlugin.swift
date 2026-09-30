import Foundation
import UIKit
import AppTrackingTransparency
import Capacitor
import UnityAds

/// Unity Ads, as much of it as Color Flood uses: one interstitial, the two
/// privacy flags Unity reads, and the App Tracking Transparency prompt. No
/// banner and no rewarded ad — the interstitial is the only format.
/// Everything about WHEN any of it happens lives in
/// src/ads.ts; this file only knows how. The Android half is the same shape.
///
/// Written against the ad-object API Unity introduced in 4.x
/// (UADSInterstitialAd and its configuration builders). The older
/// UnityAds.load/show calls still work but are deprecated as of 4.20 and
/// marked for removal.
///
/// Calls resolve when Unity says they are done rather than when they are
/// issued, so the JavaScript can await each one and trust what it gets back.
///
/// This class must stay the first Objective-C-named declaration in the file:
/// `cap sync` registers a Swift plugin by reading the first such name it
/// finds, and anything above it would be registered in its place.
@objc(UnityAdsPlugin)
public class UnityAdsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UnityAdsPlugin"
    public let jsName = "UnityAds"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConsent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadInterstitial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showInterstitial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackingStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestTracking", returnType: CAPPluginReturnPromise)
    ]

    /// One loaded interstitial, spent by showing it. Nil means load another.
    private var interstitial: UADSInterstitialAd?
    /// The call waiting on the interstitial on screen; resolved when it is dismissed.
    private var showCall: CAPPluginCall?

    @objc func initialize(_ call: CAPPluginCall) {
        guard let gameId = call.getString("gameId"), !gameId.isEmpty else {
            call.reject("No game id")
            return
        }
        if UnityAds.isInitialized() {
            call.resolve()
            return
        }
        let config = UADSInitializationConfigurationBuilder(gameId: gameId)
            .with(testMode: call.getBool("testMode") ?? false)
            .build()
        UnityAds.initialize(config) { error in
            if let error = error {
                call.reject(error.message)
            } else {
                call.resolve()
            }
        }
    }

    /// The only consent Unity has: it ships no form of its own, so it takes
    /// the answers as flags. consent is the GDPR one, read for players Unity
    /// places in the EEA or the UK; optOut is the US state-law one ("do not
    /// sell or share"). Set before initialize so the first request already
    /// carries them; set again later and every request after follows.
    @objc func setConsent(_ call: CAPPluginCall) {
        if let consent = call.getBool("consent") {
            UnityAds.setUserConsent(consent)
        }
        if let optOut = call.getBool("optOut") {
            UnityAds.setUserOptOut(optOut)
        }
        call.resolve()
    }

    @objc func loadInterstitial(_ call: CAPPluginCall) {
        guard let placementId = call.getString("placementId") else {
            call.reject("No placement id")
            return
        }
        let config = UADSLoadConfigurationBuilder(placementId: placementId).build()
        UADSInterstitialAd.load(config) { [weak self] ad, error in
            DispatchQueue.main.async {
                guard let self = self, let ad = ad else {
                    call.reject(error?.message ?? "No ad")
                    return
                }
                self.interstitial = ad
                // A loaded ad does not keep forever. Drop it when Unity says
                // it has gone stale so showInterstitial refuses cleanly and
                // the JavaScript loads a fresh one, rather than showing nothing.
                ad.onAdExpired = { [weak self] expired in
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        if self.interstitial === expired { self.interstitial = nil }
                        self.notifyListeners("interstitialExpired", data: [:])
                    }
                }
                call.resolve()
            }
        }
    }

    /// Resolves when the ad is DISMISSED, not when it starts — the game waits on it before moving on.
    @objc func showInterstitial(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let ad = self.interstitial else {
                call.reject("Not loaded")
                return
            }
            guard let viewController = self.bridge?.viewController else {
                call.reject("Nothing to show it in")
                return
            }
            self.interstitial = nil
            self.showCall = call
            let config = UADSShowConfigurationBuilder().with(viewController: viewController).build()
            ad.show(config, delegate: self)
        }
    }

    @objc func trackingStatus(_ call: CAPPluginCall) {
        call.resolve(["status": UnityAdsPlugin.name(of: ATTrackingManager.trackingAuthorizationStatus)])
    }

    /// Shows Apple's prompt the first time; after that iOS answers with the
    /// stored choice without showing anything, so calling it again is safe.
    @objc func requestTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            ATTrackingManager.requestTrackingAuthorization { status in
                call.resolve(["status": UnityAdsPlugin.name(of: status)])
            }
        }
    }

    private static func name(of status: ATTrackingManager.AuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    private func finishShow(_ error: String?) {
        guard let call = showCall else { return }
        showCall = nil
        if let error = error {
            call.reject(error)
        } else {
            call.resolve()
        }
    }
}

extension UnityAdsPlugin: UADSInterstitialShowDelegate {
    /// The ad is on screen. src/ads.ts gives up on one that has not got
    /// this far within a few seconds, so the game is never held up by it.
    public func showDidStart(_ unityAd: UADSInterstitialAd) {
        DispatchQueue.main.async { self.notifyListeners("interstitialStarted", data: [:]) }
    }

    public func showDidClick(_ unityAd: UADSInterstitialAd) {}

    public func showDidComplete(_ unityAd: UADSInterstitialAd, with finishState: UADSShowFinishState) {
        DispatchQueue.main.async { self.finishShow(nil) }
    }

    public func showDidFail(_ unityAd: UADSInterstitialAd, error: UnityAdsError) {
        let message = error.message
        DispatchQueue.main.async { self.finishShow(message) }
    }
}
