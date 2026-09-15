package com.politecarrot.colorflood;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
