# Safe Android Device Verification

Use a physical Android device only after it is connected. These steps do not erase app data or emulator data.

## Requirements

- Android SDK Platform Tools already installed at `D:\MineCordAndroidSdkCodex\platform-tools` (or use the SDK's existing `platform-tools\adb.exe`).
- A MineCord debug APK built from the current checkout at `src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`.
- A USB data cable. Enable Android Developer options and USB debugging on the test phone, then accept its device authorization prompt.

## Connect and install

In PowerShell, from the MineCord project folder:

```powershell
$adb = 'D:\MineCordAndroidSdkCodex\platform-tools\adb.exe'
$apk = (Resolve-Path '.\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk').Path
& $adb devices -l
```

Continue only when the target device appears with state `device`. If it says `unauthorized`, unlock the phone and approve the RSA fingerprint, then run `devices -l` again. Do not use `adb uninstall`, `pm clear`, emulator wipe options, or commands that erase app data.

Install or update while preserving the app's current data:

```powershell
& $adb install -r $apk
```

Launch MineCord and capture startup logs:

```powershell
& $adb shell monkey -p com.minecord.app 1
& $adb logcat -c
& $adb logcat -v time -s minecord chromium AndroidRuntime System.err
```

The log clear above clears only the device's volatile log buffer; omit it if earlier logs need to be retained. Stop log capture with Ctrl+C.

## In-app checks

1. Confirm the launcher icon and MineCord sign-in screen render, then sign in using a test account. Verify the app opens `/app`, survives background/foreground, and retains the session after a normal app restart.
2. Check that the mobile framing fits portrait and landscape without clipped controls or horizontal scrolling. Visit Settings and the Companion Pet, then exercise navigation/back behavior.
3. Test external-browser Google or Microsoft OAuth only with a configured test provider account. Confirm the provider returns to MineCord, the state/PKCE flow completes once, and cancellation or an expired return link displays a recoverable message. Do not use another person's account.
4. For notifications, grant the Android prompt only when testing notifications. Verify that message/call alerts do not reveal private message text on the lock screen.
5. For voice/video, use two independent test accounts and devices over HTTPS. Grant microphone/camera access through Android's normal prompts. Test incoming call, accept/decline, mute, deafen, camera off/on, group membership, app background/foreground, network interruption/reconnect, and leaving a call. Confirm the call ends and microphone/camera indicators turn off afterward.
6. Send a test DM, force-stop normally, relaunch, and confirm the message remains. Repeat only on a staging service with a confirmed persistent database disk.

## Performance and crash evidence

Record device model, Android version, APK SHA-256, and test time. For a basic frame report:

```powershell
& $adb shell dumpsys gfxinfo com.minecord.app reset
# Exercise the app for a consistent 60 seconds.
& $adb shell dumpsys gfxinfo com.minecord.app framestats
```

Save the output and note whether the app crashed, froze, or dropped frames. Avoid enabling verbose WebView logging or collecting account/message contents in shared logs. Remove tokens, email addresses, phone numbers, and message text before sharing any log.

A successful debug install is not a Play release check: production verification also needs release signing, Play policy review, supported SDK/permission declarations, store listing assets, and a signed release build.
