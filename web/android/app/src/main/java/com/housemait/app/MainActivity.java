package com.housemait.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Housemait ships its own responsive sizing (matching the iOS/WKWebView
        // build). Android's WebView, by default, ALSO scales all text by the
        // system Font size / Display size accessibility settings - so on devices
        // that ship those larger by default (e.g. Samsung One UI), everything
        // renders oversized and layouts clip (the AI composer's send button ran
        // off-screen on a Galaxy S25). WKWebView on iOS ignores Dynamic Type for
        // web content, which is why iOS looked correct. Pin the text zoom to 100%
        // so the app renders at its designed size on every Android device.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
        }
    }
}
