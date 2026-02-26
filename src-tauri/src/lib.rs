mod capture;
mod s3;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub aws_access_key_id: String,
    pub aws_secret_access_key: String,
    pub aws_region: String,
    pub s3_bucket: String,
    pub custom_domain: String,
    pub make_public: bool,
    pub save_directory: String,
    #[serde(default = "default_shortcut")]
    pub capture_shortcut: String,
}

fn default_shortcut() -> String {
    "CommandOrControl+Shift+S".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            aws_access_key_id: String::new(),
            aws_secret_access_key: String::new(),
            aws_region: "us-east-1".to_string(),
            s3_bucket: String::new(),
            custom_domain: String::new(),
            make_public: true,
            save_directory: dirs::picture_dir()
                .unwrap_or_else(|| PathBuf::from("~/Pictures"))
                .to_string_lossy()
                .to_string(),
            capture_shortcut: default_shortcut(),
        }
    }
}

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("shotty");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("settings.json")
}

#[tauri::command]
fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn capture_screenshot(window: tauri::Window) -> Result<String, String> {
    capture::take_screenshot(window).await
}

#[tauri::command]
async fn capture_fullscreen(window: tauri::Window, display: u32) -> Result<String, String> {
    capture::take_fullscreen(window, display).await
}

#[tauri::command]
fn list_displays() -> Vec<capture::DisplayInfo> {
    capture::get_displays()
}

#[tauri::command]
fn show_display_highlight(app: tauri::AppHandle, index: u32) -> Result<(), String> {
    let displays = capture::get_displays();
    let d = displays
        .iter()
        .find(|d| d.index == index)
        .ok_or_else(|| "Display not found".to_string())?;

    let size = tauri::LogicalSize::new(d.screen_width, d.screen_height);
    let pos = tauri::LogicalPosition::new(d.screen_x, d.screen_y);

    if let Some(win) = app.get_webview_window("display_highlight") {
        let _ = win.set_size(size);
        let _ = win.set_position(pos);
        let _ = win.show();
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    } else {
        let mut builder = WebviewWindowBuilder::new(
            &app,
            "display_highlight",
            WebviewUrl::App("highlight.html".into()),
        );

        builder = builder
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .position(d.screen_x, d.screen_y)
            .inner_size(d.screen_width, d.screen_height);

        // Transparent windows require macos-private-api on macOS
        #[cfg(target_os = "macos")]
        {
            builder = builder.transparent(true);
        }

        let win = builder
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

        win.set_ignore_cursor_events(true)
            .map_err(|e: tauri::Error| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn hide_display_highlight(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("display_highlight") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn upload_to_s3(image_data: String, filename: String) -> Result<String, String> {
    let settings = load_settings();
    s3::upload(settings, image_data, filename).await
}

#[tauri::command]
async fn save_to_disk(image_data: String, filename: String) -> Result<String, String> {
    let settings = load_settings();
    let save_dir = PathBuf::from(&settings.save_directory);
    fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;

    let filepath = save_dir.join(&filename);
    let raw = image_data
        .trim_start_matches("data:image/png;base64,")
        .to_string();
    let data = STANDARD.decode(&raw).map_err(|e| e.to_string())?;
    fs::write(&filepath, &data).map_err(|e| e.to_string())?;

    Ok(filepath.to_string_lossy().to_string())
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_image_to_clipboard(image_data: String) -> Result<(), String> {
    let raw = image_data
        .trim_start_matches("data:image/png;base64,")
        .to_string();
    let bytes = STANDARD.decode(&raw).map_err(|e| e.to_string())?;

    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn test_s3_connection(settings: AppSettings) -> Result<String, String> {
    s3::test_connection(settings).await
}

#[tauri::command]
fn update_shortcut(app: tauri::AppHandle, new_shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !new_shortcut.is_empty() {
        gs.register(new_shortcut.as_str())
            .map_err(|e| format!("Invalid shortcut: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("captureRegion()");
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Build tray menu
            let show = MenuItem::with_id(app, "show", "Show Shotty", true, None::<&str>)?;
            let capture =
                MenuItem::with_id(app, "capture", "Capture Region", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Shotty", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &capture, &separator, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Shotty")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "capture" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("captureRegion()");
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Register global capture shortcut from saved settings
            let settings = load_settings();
            let shortcut_str = if settings.capture_shortcut.is_empty() {
                default_shortcut()
            } else {
                settings.capture_shortcut.clone()
            };
            if let Err(e) = app.global_shortcut().register(shortcut_str.as_str()) {
                eprintln!("Failed to register global shortcut '{}': {}", shortcut_str, e);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide instead of close — the app lives in the menu bar
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            capture_screenshot,
            capture_fullscreen,
            list_displays,
            show_display_highlight,
            hide_display_highlight,
            upload_to_s3,
            save_to_disk,
            copy_to_clipboard,
            copy_image_to_clipboard,
            test_s3_connection,
            update_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shotty");
}
