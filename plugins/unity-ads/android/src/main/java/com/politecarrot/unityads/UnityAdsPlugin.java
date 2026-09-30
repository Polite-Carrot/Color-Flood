package com.politecarrot.unityads;

import android.app.Activity;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.BannerAd;
import com.unity3d.ads.BannerConfiguration;
import com.unity3d.ads.BannerShowListener;
import com.unity3d.ads.BannerSize;
import com.unity3d.ads.InitializationConfiguration;
import com.unity3d.ads.InterstitialAd;
import com.unity3d.ads.InterstitialShowListener;
import com.unity3d.ads.LoadConfiguration;
import com.unity3d.ads.ShowConfiguration;
import com.unity3d.ads.ShowFinishState;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsError;

/**
 * Unity Ads, as much of it as Color Flood uses: one interstitial, one banner
 * along the bottom, the two privacy flags Unity reads, and a tracking status
 * that exists only so the JavaScript can ask the same question on both
 * platforms. Everything about WHEN any of it happens lives in src/ads.ts;
 * this file only knows how.
 *
 * Written against the ad-object API Unity introduced in 4.x (InterstitialAd,
 * BannerAd, configuration builders). The older UnityAds.load/show and
 * BannerView calls still work but are deprecated as of 4.20 and marked for
 * removal; the iOS half uses the same new API so the two read alike.
 *
 * Calls resolve when Unity says they are done rather than when they are
 * issued — initialize when the SDK is ready, loadInterstitial when an ad is
 * in hand, showInterstitial when it has been dismissed — so the JavaScript can
 * await each one and trust what it gets back.
 */
@CapacitorPlugin(name = "UnityAds")
public class UnityAdsPlugin extends Plugin {

    /** The small strip, and the one src/ads.ts reserves room for. */
    private static final int BANNER_W = 320;
    private static final int BANNER_H = 50;

    /** One loaded interstitial, spent by showing it. Null means load another. */
    private InterstitialAd interstitial;

    /** Fixed at the bottom of the screen and made once; banners come and go inside it. */
    private FrameLayout bannerSlot;
    private BannerAd banner;
    private boolean bannerLoading;
    private String bannerPlacement;

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

    /**
     * The slot is made once and then hidden and shown, and a banner is loaded
     * only when there is none — never one per screen change, which is both
     * slower to appear and a good way to have the traffic noticed.
     *
     * Drawn OVER the web view, not beside it — the page is not resized. What
     * keeps it off the colour swatches is the page itself reserving the strip,
     * which it does when "bannerLoaded" arrives with the height to reserve.
     */
    @PluginMethod
    public void showBanner(PluginCall call) {
        String placementId = call.getString("placementId");
        Activity activity = getActivity();
        if (placementId == null || activity == null) {
            call.reject("Nothing to show it in");
            return;
        }
        activity.runOnUiThread(() -> {
            bannerPlacement = placementId;
            if (bannerSlot == null) bannerSlot = makeSlot(activity);
            bannerSlot.setVisibility(View.VISIBLE);
            if (banner != null) announceBanner();
            else loadBanner(activity);
            call.resolve();
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || bannerSlot == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            bannerSlot.setVisibility(View.GONE);
            call.resolve();
        });
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

    private FrameLayout makeSlot(Activity activity) {
        float density = activity.getResources().getDisplayMetrics().density;
        FrameLayout slot = new FrameLayout(activity);
        FrameLayout.LayoutParams where = new FrameLayout.LayoutParams(
            Math.round(BANNER_W * density),
            Math.round(BANNER_H * density),
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        ViewGroup root = activity.findViewById(android.R.id.content);
        root.addView(slot, where);
        liftAboveSystemBars(slot);
        return slot;
    }

    private void loadBanner(Activity activity) {
        if (bannerLoading) return;
        bannerLoading = true;
        BannerConfiguration config = new BannerConfiguration.Builder(
            bannerPlacement,
            new BannerSize(BANNER_W, BANNER_H),
            new BannerShowListener() {
                @Override
                public void onImpression(BannerAd ad) {}

                @Override
                public void onClicked(BannerAd ad) {}

                @Override
                public void onFailedToShow(BannerAd ad, UnityAdsError error) {
                    activity.runOnUiThread(() -> dropBanner(ad));
                }
            }
        ).build();
        BannerAd.load(config, (ad, error) ->
            activity.runOnUiThread(() -> {
                bannerLoading = false;
                if (ad == null) {
                    notifyListeners("bannerFailed", new JSObject());
                    return;
                }
                banner = ad;
                bannerSlot.removeAllViews();
                bannerSlot.addView(
                    ad.getView(),
                    new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                );
                // Stale banners are replaced in place, and only while the
                // slot is showing — a hidden one waits for the next showBanner.
                ad.setOnAdExpired(expired ->
                    activity.runOnUiThread(() -> {
                        if (banner != expired) return;
                        dropBanner(expired);
                        if (bannerSlot.getVisibility() == View.VISIBLE) loadBanner(activity);
                    })
                );
                announceBanner();
            })
        );
    }

    private void dropBanner(BannerAd ad) {
        if (banner != ad) return;
        banner = null;
        bannerSlot.removeAllViews();
        notifyListeners("bannerFailed", new JSObject());
    }

    /** Height in dp, which is what a CSS pixel is inside the web view. */
    private void announceBanner() {
        JSObject data = new JSObject();
        data.put("height", BANNER_H);
        notifyListeners("bannerLoaded", data);
    }

    /**
     * Sits above the navigation bar rather than under it. On a phone drawing
     * edge to edge the content view runs behind the system bars and this is
     * their height; on one that is not, the insets were consumed further up
     * and this is 0 — the right answer both ways without asking which.
     */
    private void liftAboveSystemBars(View view) {
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) v.getLayoutParams();
            lp.bottomMargin = bars.bottom;
            v.setLayoutParams(lp);
            return insets;
        });
        ViewCompat.requestApplyInsets(view);
    }
}
