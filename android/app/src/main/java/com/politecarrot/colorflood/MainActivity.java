package com.politecarrot.colorflood;

import android.content.pm.ActivityInfo;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Portrait on a phone, free on a tablet.
     *
     * The manifest cannot say that on its own — android:screenOrientation is
     * one value for every device — so the decision comes from a resource
     * instead. R.bool.lock_portrait is true in values/ and false in
     * values-sw600dp/, which is Android's own line between the two: 600dp of
     * smallest width. That gives the same split Info.plist gives iPhone and
     * iPad.
     *
     * The reason for the lock is the board. It is square and limited by the
     * width, so a sideways phone spends its long axis on nothing: measured at
     * 844x390, a 14x14 board came out 168px — 12px a cell — against 364px the
     * right way up.
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getResources().getBoolean(R.bool.lock_portrait)) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }
    }

    /**
     * Android's system font-size setting scales the text inside a WebView and
     * nothing else. The boxes around it are still the size CSS asked for, and
     * the board is still the size JavaScript measured, so at the larger
     * settings the letters on the swatches and the labels on the buttons grow
     * out of the things holding them.
     *
     * Pinning the text zoom to 100 leaves the page the size it was designed
     * at. The matching switch on the web and on iOS is text-size-adjust in
     * styles.css; this one has no CSS equivalent, it is a WebView setting.
     *
     * Not in onCreate: the bridge and its web view are built there, so the
     * earliest this can be asked for them is onStart.
     */
    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(100);
        }
    }
}
