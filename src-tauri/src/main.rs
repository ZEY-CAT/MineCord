use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

struct PendingUpdate(std::sync::Mutex<Option<Update>>);

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

fn show_update_state(app: &tauri::AppHandle, function: &str, arguments: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!("window.{function}({arguments})"));
    }
}

#[tauri::command]
fn updates_enabled() -> bool {
    !cfg!(debug_assertions) && option_env!("MINECORD_UPDATER_ENABLED") == Some("1")
}

#[tauri::command]
async fn check_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    if !updates_enabled() {
        return Ok(None);
    }
    if let Some(update) = pending.0.lock().map_err(|_| "The updater state is unavailable.")?.as_ref() {
        return Ok(Some(UpdateInfo { version: update.version.clone(), notes: update.body.clone() }));
    }

    let update = app.updater().map_err(|_| "The signed updater is not configured.")?
        .check().await.map_err(|_| "MINECORD could not check the signed update service.")?;
    let Some(update) = update else { return Ok(None) };
    let info = UpdateInfo { version: update.version.clone(), notes: update.body.clone() };
    *pending.0.lock().map_err(|_| "The updater state is unavailable.")? = Some(update);
    Ok(Some(info))
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    if !updates_enabled() {
        return Err("Automatic updates are not configured for this build.".into());
    }
    let update = pending.0.lock().map_err(|_| "The updater state is unavailable.")?
        .take().ok_or("There is no verified update ready to install.")?;
    let progress_app = app.clone();
    update.download_and_install(
        move |chunk, total| {
            let total = total.map_or("null".to_string(), |value| value.to_string());
            show_update_state(&progress_app, "minecordUpdateProgress", &format!("{chunk}, {total}"));
        },
        || {},
    ).await.map_err(|_| "The update could not be downloaded or verified. Your installed version was not replaced.".to_string())?;
    app.restart();
}

#[cfg(target_os = "android")]
#[tauri::command]
fn request_microphone_permission() -> Result<(), String> {
    use jni::objects::{JClass, JObject};
    use jni::JNIEnv;
    use ndk_context::android_context;

    let ctx = unsafe { android_context() };
    let env = unsafe { JNIEnv::from_raw(ctx.vm().cast()) }.map_err(|e| format!("JNIEnv error: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Request RECORD_AUDIO permission at runtime
    let activity_class = env.get_object_class(&activity).map_err(|e| format!("Get class error: {e}"))?;
    let request_permissions = env.get_method_id(activity_class, "requestPermissions", "([Ljava/lang/String;I)V")
        .map_err(|e| format!("Get method error: {e}"))?;

    let permissions = env.new_object_array(1, env.find_class("java/lang/String").map_err(|e| format!("Find String class error: {e}"))?, JObject::null())
        .map_err(|e| format!("New array error: {e}"))?;
    let permission_str = env.new_string("android.permission.RECORD_AUDIO").map_err(|e| format!("New string error: {e}"))?;
    env.set_object_array_element(permissions, 0, permission_str).map_err(|e| format!("Set element error: {e}"))?;

    env.call_method_unchecked(&activity, request_permissions, jni::signature::ReturnType::Void, &[permissions.into(), 42.into()])
        .map_err(|e| format!("Call method error: {e}"))?;

    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(PendingUpdate(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            updates_enabled,
            check_update,
            install_update,
            #[cfg(target_os = "android")]
            request_microphone_permission
        ]);

    #[cfg(target_os = "android")]
    let builder = builder.setup(|app| {
        // Android-specific setup: keep screen on for voice calls
        use android_activity::AndroidApp;
        use jni::objects::{JClass, JObject};
        use jni::JNIEnv;
        use ndk_context::android_context;

        let ctx = unsafe { android_context() };
        let env = unsafe { JNIEnv::from_raw(ctx.vm().cast()) }.map_err(|e| format!("JNIEnv error: {e}"))?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        let activity_class = env.get_object_class(&activity).map_err(|e| format!("Get class error: {e}"))?;
        let get_window = env.get_method_id(activity_class, "getWindow", "()Landroid/view/Window;")
            .map_err(|e| format!("Get getWindow error: {e}"))?;
        let window = env.call_method_unchecked(&activity, get_window, jni::signature::ReturnType::Object, &[])
            .map_err(|e| format!("Call getWindow error: {e}"))?.l().map_err(|e| format!("Get window object error: {e}"))?;

        let window_class = env.get_object_class(&window).map_err(|e| format!("Get window class error: {e}"))?;
        let add_flags = env.get_method_id(window_class, "addFlags", "(I)V")
            .map_err(|e| format!("Get addFlags error: {e}"))?;

        // FLAG_KEEP_SCREEN_ON = 0x08000000
        env.call_method_unchecked(&window, add_flags, jni::signature::ReturnType::Void, &[0x08000000i32.into()])
            .map_err(|e| format!("Call addFlags error: {e}"))?;

        Ok(())
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("MINECORD initialization failed");

    app.run(|_, _| {});
}