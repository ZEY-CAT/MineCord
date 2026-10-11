# ProGuard rules for MINECORD Android app
# Keep Tauri and WebView related classes

-keep class com.tauri.** { *; }
-keep class com.minecord.app.** { *; }

# Keep WebView and WebRTC classes
-keep class android.webkit.** { *; }
-keep class org.webrtc.** { *; }

# Keep Kotlin coroutines
-keep class kotlinx.coroutines.** { *; }

# Keep SLF4J
-keep class org.slf4j.** { *; }