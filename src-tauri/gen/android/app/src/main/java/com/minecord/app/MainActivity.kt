package com.minecord.app

import android.os.Bundle
import android.webkit.WebView

/**
 * MainActivity for MINECORD Android app.
 * Extends TauriActivity to provide WebRTC microphone permission handling.
 */
class MainActivity : TauriActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Enable hardware acceleration for WebRTC
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )

        // Keep screen on for voice calls
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        super.onCreate(savedInstanceState)
    }
}
