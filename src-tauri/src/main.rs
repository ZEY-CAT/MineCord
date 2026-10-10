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

fn main() {
    let app = tauri::Builder::default()
        .manage(PendingUpdate(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![updates_enabled, check_update, install_update])
        .build(tauri::generate_context!())
        .expect("MINECORD desktop initialization failed");
    app.run(|_, _| {});
}
