package com.politecarrot.unityads;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.InitializationConfiguration;
import com.unity3d.ads.InterstitialAd;
import com.unity3d.ads.InterstitialShowListener;
import com.unity3d.ads.LoadConfiguration;
import com.unity3d.ads.ShowConfiguration;
import com.unity3d.ads.ShowFinishState;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsError;

/**
 * Unity Ads, as much of it as Color Flood uses: one interstitial, the two
 * privacy flags Unity reads, and a tracking status that exists only so the
 * JavaScript can ask the same question on both platforms. No banner and no
 * rewarded ad — the interstitial is the only format. Everything about WHEN any of it happens lives in src/ads.ts;
 * this file only knows how.
 *
 * Written against the ad-object API Unity introduced in 4.x (InterstitialAd
 * and its configuration builders). The older UnityAds.load/show calls still
 * work but are deprecated as of 4.20 and marked for removal; the iOS half
 * uses the same new API so the two read alike.
 *
 * Calls resolve when Unity says they are done rather than when they are
 * issued — initialize when the SDK is ready, loadInterstitial when an ad is
 * in hand, showInterstitial when it has been dismissed — so the JavaScript can
 * await each one and trust what it gets back.
 */
@CapacitorPlugin(name = "UnityAds")
public class UnityAdsPlugin extends Plugin {

    /** One loaded interstitial, spent by showing it. Null means load another. */
    private InterstitialAd interstitial;

    @PluginMethod
    public void initialize(PluginCall call) {
        String gameId = call.getString("gameId");
        if (gameId == null || gameId.isEmpty()) {
            call.reject("No game id");
            return;
        }
        if (UnityAds.isInitialized()) {
            call.resolve();
            return;
        }
        boolean testMode = Boolean.TRUE.equals(call.getBoolean("testMode", false));
        InitializationConfiguration config = new InitializationConfiguration.Builder(gameId).withTestMode(testMode).build();
        UnityAds.initialize(config, error -> {
            if (error == null) call.resolve();
            else call.reject(error.getMessage());
        });
    }

    /**
     * The only consent Unity has: it ships no form of its own, so it takes
     * the answers as flags. consent is the GDPR one, read for players Unity
     * places in the EEA or the UK; optOut is the US state-law one ("do not
     * sell or share"). Set before initialize so the first request already
     * carries them; set again later and every request after follows.
     */
    @PluginMethod
    public void setConsent(PluginCall call) {
        Boolean consent = call.getBoolean("consent");
        Boolean optOut = call.getBoolean("optOut");
        if (consent != null) UnityAds.setUserConsent(consent);
        if (optOut != null) UnityAds.setUserOptOut(optOut);
        call.resolve();
    }

    @PluginMethod
    public void loadInterstitial(PluginCall call) {
        String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("No placement id");
            return;
        }
        InterstitialAd.load(new LoadConfiguration.Builder(placementId).build(), (ad, error) -> {
            if (ad == null) {
                call.reject(error != null ? error.getMessage() : "No ad");
                return;
            }
            interstitial = ad;
            // A loaded ad does not keep forever. Drop it when Unity says it
            // has gone stale so showInterstitial refuses cleanly and the
            // JavaScript loads a fresh one, rather than showing nothing.
            ad.setOnAdExpired(expired -> {
                if (interstitial == expired) interstitial = null;
                notifyListeners("interstitialExpired", new JSObject());
            });
            call.resolve();
        });
    }

    /** Resolves when the ad is DISMISSED, not when it starts — the game waits on it before moving on. */
    @PluginMethod
    public void showInterstitial(PluginCall call) {
        InterstitialAd ad = interstitial;
        Activity activity = getActivity();
        if (ad == null) {
            call.reject("Not loaded");
            return;
        }
        if (activity == null) {
            call.reject("Nothing to show it in");
            return;
        }
        interstitial = null;
        activity.runOnUiThread(() ->
            ad.show(
                activity,
                new ShowConfiguration.Builder().build(),
                new InterstitialShowListener() {
                    /** The ad is on screen. src/ads.ts gives up on one that has not got this far within a few seconds. */
                    @Override
                    public void onStarted(InterstitialAd shown) {
                        notifyListeners("interstitialStarted", new JSObject());
                    }

                    @Override
                    public void onClicked(InterstitialAd shown) {}

                    @Override
                    public void onCompleted(InterstitialAd shown, ShowFinishState state) {
                        call.resolve();
                    }

                    @Override
                    public void onFailed(InterstitialAd shown, UnityAdsError error) {
                        call.reject(error != null ? error.getMessage() : "Show failed");
                    }
                }
            )
        );
    }

    /** Android has no tracking prompt. What governs personalisation here is the privacy flags. */
    @PluginMethod
    public void trackingStatus(PluginCall call) {
        call.resolve(authorised());
    }

    @PluginMethod
    public void requestTracking(PluginCall call) {
        call.resolve(authorised());
    }

    private JSObject authorised() {
        JSObject result = new JSObject();
        result.put("status", "authorized");
        return result;
    }
}
