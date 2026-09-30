import Foundation
import UIKit
import AppTrackingTransparency
import Capacitor
import UnityAds

/// Unity Ads, as much of it as Color Flood uses: one interstitial, one banner
/// along the bottom, the two privacy flags Unity reads, and the App Tracking
/// Transparency prompt. Everything about WHEN any of it happens lives in
/// src/ads.ts; this file only knows how. The Android half is the same shape.
///
/// Written against the ad-object API Unity introduced in 4.x
/// (UADSInterstitialAd, UADSBannerAd, configuration builders). The older
/// UnityAds.load/show and UADSBannerView calls still work but are deprecated
/// as of 4.20 and marked for removal.
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
        CAPPluginMethod(name: "showBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackingStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestTracking", returnType: CAPPluginReturnPromise)
    ]

    /// The small strip, and the one src/ads.ts reserves room for.
    private let bannerSize = CGSize(width: 320, height: 50)

    /// One loaded interstitial, spent by showing it. Nil means load another.
    private var interstitial: UADSInterstitialAd?
    /// The call waiting on the interstitial on screen; resolved when it is dismissed.
    private var showCall: CAPPluginCall?

    /// Fixed at the bottom of the screen and made once; banners come and go inside it.
    private var bannerSlot: UIView?
    private var banner: UADSBannerAd?
    private var bannerLoading = false
    private var bannerPlacement: String?

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

    /// The slot is made once and then hidden and shown, and a banner is
    /// loaded only when there is none — never one per screen change, which is
    /// both slower to appear and a good way to have the traffic noticed.
    ///
    /// Drawn OVER the web view, not beside it — the page is not resized. What
    /// keeps it off the colour swatches is the page itself reserving the
    /// strip, which it does when "bannerLoaded" arrives with the height.
    @objc func showBanner(_ call: CAPPluginCall) {
        guard let placementId = call.getString("placementId") else {
            call.reject("No placement id")
            return
        }
        DispatchQueue.main.async {
            guard let slot = self.bannerSlot ?? self.makeSlot() else {
                call.reject("Nothing to show it in")
                return
            }
            self.bannerPlacement = placementId
            slot.isHidden = false
            if self.banner != nil {
                self.announceBanner()
            } else {
                self.loadBanner()
            }
            call.resolve()
        }
    }

    @objc func hideBanner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.bannerSlot?.isHidden = true
            call.resolve()
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

    private func makeSlot() -> UIView? {
        guard let host = bridge?.viewController?.view else { return nil }
        let slot = UIView()
        slot.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(slot)
        NSLayoutConstraint.activate([
            slot.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            slot.bottomAnchor.constraint(equalTo: host.safeAreaLayoutGuide.bottomAnchor),
            slot.widthAnchor.constraint(equalToConstant: bannerSize.width),
            slot.heightAnchor.constraint(equalToConstant: bannerSize.height)
        ])
        bannerSlot = slot
        return slot
    }

    private func loadBanner() {
        guard !bannerLoading, let placementId = bannerPlacement else { return }
        bannerLoading = true
        let config = UADSBannerLoadConfigurationBuilder(placementId: placementId, bannerSize: bannerSize, delegate: self).build()
        UADSBannerAd.load(config) { [weak self] ad, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.bannerLoading = false
                guard let ad = ad, let slot = self.bannerSlot else {
                    self.notifyListeners("bannerFailed", data: [:])
                    return
                }
                self.banner = ad
                slot.subviews.forEach { $0.removeFromSuperview() }
                let view = ad.view
                view.translatesAutoresizingMaskIntoConstraints = false
                slot.addSubview(view)
                NSLayoutConstraint.activate([
                    view.leadingAnchor.constraint(equalTo: slot.leadingAnchor),
                    view.trailingAnchor.constraint(equalTo: slot.trailingAnchor),
                    view.topAnchor.constraint(equalTo: slot.topAnchor),
                    view.bottomAnchor.constraint(equalTo: slot.bottomAnchor)
                ])
                // Stale banners are replaced in place, and only while the
                // slot is showing — a hidden one waits for the next showBanner.
                ad.onAdExpired = { [weak self] expired in
                    DispatchQueue.main.async {
                        guard let self = self, self.banner === expired else { return }
                        self.dropBanner(expired)
                        if self.bannerSlot?.isHidden == false { self.loadBanner() }
                    }
                }
                self.announceBanner()
            }
        }
    }

    private func dropBanner(_ ad: UADSBannerAd) {
        guard banner === ad else { return }
        banner = nil
        bannerSlot?.subviews.forEach { $0.removeFromSuperview() }
        notifyListeners("bannerFailed", data: [:])
    }

    /// Height in points, which is what a CSS pixel is inside the web view.
    private func announceBanner() {
        notifyListeners("bannerLoaded", data: ["height": Int(bannerSize.height)])
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
    public func showDidStart(_ unityAd: UADSInterstitialAd) {}

    public func showDidClick(_ unityAd: UADSInterstitialAd) {}

    public func showDidComplete(_ unityAd: UADSInterstitialAd, with finishState: UADSShowFinishState) {
        DispatchQueue.main.async { self.finishShow(nil) }
    }

    public func showDidFail(_ unityAd: UADSInterstitialAd, error: UnityAdsError) {
        let message = error.message
        DispatchQueue.main.async { self.finishShow(message) }
    }
}

extension UnityAdsPlugin: UADSBannerAdDelegate {
    public func bannerImpression(_ banner: UADSBannerAd) {}

    public func bannerDidClick(_ banner: UADSBannerAd) {}

    public func bannerDidFailShow(_ banner: UADSBannerAd, error: UnityAdsError) {
        DispatchQueue.main.async { self.dropBanner(banner) }
    }
}
