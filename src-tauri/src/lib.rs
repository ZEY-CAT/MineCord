use serde::Serialize;
use tauri::{Manager, State};

use tauri_plugin_updater::{Update, UpdaterExt};

struct PendingUpdate(std::sync::Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
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
async fn set_companion_overlay(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if !visible {
        if let Some(window) = app.get_webview_window("companion") {
            window.close().map_err(|_| "The desktop pet could not be closed.".to_string())?;
        }
        return Ok(());
    }

    #[cfg(mobile)]
    {
        return Err("A desktop pet overlay is not available on this device.".into());
    }

    #[cfg(not(mobile))]
    {
        use tauri::webview::WebviewWindowBuilder;
        use tauri::WebviewUrl;

        if let Some(window) = app.get_webview_window("companion") {
            window.show().map_err(|_| "The desktop pet could not be shown.".to_string())?;
            return Ok(());
        }

        let url = "https://minecord-8vg2.onrender.com/companion.html?companionOverlay=1"
            .parse()
            .map_err(|_| "The desktop pet address is invalid.".to_string())?;
        WebviewWindowBuilder::new(&app, "companion", WebviewUrl::External(url))
            .title("MineCord Companion")
            .inner_size(176.0, 164.0)
            .min_inner_size(140.0, 130.0)
            .max_inner_size(240.0, 220.0)
            .position(48.0, 48.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .build()
            .map_err(|_| "The desktop pet overlay could not be opened.".to_string())?;
        Ok(())
    }
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
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PendingUpdate(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            updates_enabled,
            check_update,
            install_update,
            set_companion_overlay
        ])
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .build(tauri::generate_context!())
        .expect("MINECORD initialization failed");

    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        if let Err(error) = app.deep_link().register_all() {
            eprintln!("MINECORD could not register its sign-in return link: {error}");
        }
    }

    app.run(|_, _| {});
}
