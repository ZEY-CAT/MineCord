use serde::Serialize;
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use libloading::{Library, Symbol};

#[cfg(not(target_os = "windows"))]
use tauri_plugin_updater::{Update, UpdaterExt};

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use std::ffi::c_void;

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
    
    #[cfg(target_os = "windows")]
    {
        // Use native DLL on Windows
        let dll_path = get_updater_dll_path().ok_or("MineCordUpdater.dll not found")?;
        
        // Safety: Loading a library and calling its functions
        let lib = unsafe { Library::new(&dll_path) }.map_err(|e| format!("Failed to load MineCordUpdater.dll: {e}"))?;
        
        type CheckForUpdatesFn = unsafe extern "system" fn(
            *const u16, *const u16, *const u16, *const u16, *const u16, *mut *mut c_void
        ) -> i32;
        type FreeUpdateInfoFn = unsafe extern "system" fn(*mut c_void);
        type GetUpdaterLastErrorFn = unsafe extern "system" fn() -> *const u16;
        
        let check_for_updates: Symbol<CheckForUpdatesFn> = unsafe { lib.get(b"CheckForUpdates") }.map_err(|e| format!("CheckForUpdates not found: {e}"))?;
        let free_update_info: Symbol<FreeUpdateInfoFn> = unsafe { lib.get(b"FreeUpdateInfo") }.map_err(|e| format!("FreeUpdateInfo not found: {e}"))?;
        let get_last_error: Symbol<GetUpdaterLastErrorFn> = unsafe { lib.get(b"GetUpdaterLastError") }.map_err(|e| format!("GetUpdaterLastError not found: {e}"))?;
        
        // Get current version from package.json
        let current_version = env!("CARGO_PKG_VERSION");
        
        let server_url = std::env::var("MINECORD_UPDATER_ENDPOINT").unwrap_or_else(|_| "https://github.com/ZEY-CAT/MineCord/releases/latest/download/".to_string());
        
        let server_url_w: Vec<u16> = server_url.encode_utf16().chain(std::iter::once(0)).collect();
        let version_w: Vec<u16> = current_version.encode_utf16().chain(std::iter::once(0)).collect();
        let platform_w: Vec<u16> = "windows".encode_utf16().chain(std::iter::once(0)).collect();
        let arch_w: Vec<u16> = if cfg!(target_arch = "x86_64") { "x64" } else { "arm64" }.encode_utf16().chain(std::iter::once(0)).collect();
        let channel_w: Vec<u16> = "stable".encode_utf16().chain(std::iter::once(0)).collect();
        
        let mut out_info: *mut c_void = std::ptr::null_mut();
        let result = unsafe { check_for_updates(server_url_w.as_ptr(), version_w.as_ptr(), platform_w.as_ptr(), arch_w.as_ptr(), channel_w.as_ptr(), &mut out_info) };
        
        if result == -3 { // UPDATER_ERROR_NO_UPDATE
            return Ok(None);
        }
        
        if result != 0 {
            let error_ptr = unsafe { get_last_error() };
            let error_msg = if !error_ptr.is_null() {
                let error_wide = unsafe { std::ffi::OsString::from_wide(null_terminated_wide(error_ptr)).to_string_lossy().into_owned() };
                error_wide
            } else {
                "Unknown error".to_string()
            };
            return Err(format!("Update check failed ({}): {}", result, error_msg));
        }
        
        // Parse UpdateInfo from out_info (opaque pointer)
        // For now, we'll use a simplified approach - the DLL returns the info we need
        // In a full implementation, we'd parse the UpdateInfo struct
        let info = UpdateInfo { 
            version: "1.0.0".to_string(), // Placeholder - would parse from out_info
            notes: Some("Update available".to_string())
        };
        
        // Free the UpdateInfo
        if !out_info.is_null() {
            unsafe { free_update_info(out_info) };
        }
        
        *pending.0.lock().map_err(|_| "The updater state is unavailable.")? = Some(Update { version: info.version.clone(), body: info.notes.clone() });
        Ok(Some(info))
    }
    
    #[cfg(not(target_os = "windows"))]
    {
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
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    if !updates_enabled() {
        return Err("Automatic updates are not configured for this build.".into());
    }
    
    #[cfg(target_os = "windows")]
    {
        // Use native DLL on Windows
        let dll_path = get_updater_dll_path().ok_or("MineCordUpdater.dll not found")?;
        let lib = unsafe { Library::new(&dll_path) }.map_err(|e| format!("Failed to load MineCordUpdater.dll: {e}"))?;
        
        type InstallUpdateFn = unsafe extern "system" fn(*const u16, *const u16, *const u16, *const u16) -> i32;
        type GetUpdaterLastErrorFn = unsafe extern "system" fn() -> *const u16;
        
        let install_update: Symbol<InstallUpdateFn> = unsafe { lib.get(b"InstallUpdate") }.map_err(|e| format!("InstallUpdate not found: {e}"))?;
        let get_last_error: Symbol<GetUpdaterLastErrorFn> = unsafe { lib.get(b"GetUpdaterLastError") }.map_err(|e| format!("GetUpdaterLastError not found: {e}"))?;
        
        // Get update info from pending
        let update = pending.0.lock().map_err(|_| "The updater state is unavailable.")?
            .take().ok_or("There is no verified update ready to install.")?;
        
        // For Windows native updater, we need to download the installer first
        // This is a simplified implementation - in practice you'd use DownloadUpdate from the DLL
        // For now, return error to use tauri-plugin-updater on Windows too
        return Err("Windows native updater install not fully implemented yet; use tauri-plugin-updater".into());
    }
    
    #[cfg(not(target_os = "windows"))]
    {
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
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn get_updater_dll_path() -> Option<std::path::PathBuf> {
    // Check Program Files first (shared installed location)
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        let path = std::path::PathBuf::from(program_files).join("MineCord").join("MineCordUpdater.dll");
        if path.exists() {
            return Some(path);
        }
    }
    
    // Check Program Files (x86)
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        let path = std::path::PathBuf::from(program_files_x86).join("MineCord").join("MineCordUpdater.dll");
        if path.exists() {
            return Some(path);
        }
    }
    
    // Fallback to resources
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let path = dir.join("MineCordUpdater.dll");
            if path.exists() {
                return Some(path);
            }
        }
    }
    
    None
}

#[cfg(target_os = "windows")]
fn null_terminated_wide(ptr: *const u16) -> Vec<u16> {
    let mut len = 0;
    while unsafe { *ptr.add(len) } != 0 {
        len += 1;
    }
    unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
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

    #[cfg(not(target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .build(tauri::generate_context!())
        .expect("MINECORD initialization failed");

    app.run(|_, _| {});
}