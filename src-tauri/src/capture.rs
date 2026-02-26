use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::process::Command;

// ---- macOS CoreGraphics FFI ----

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint { x: f64, y: f64 }

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize { width: f64, height: f64 }

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect { origin: CGPoint, size: CGSize }

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayPixelsWide(display: u32) -> usize;
    fn CGDisplayPixelsHigh(display: u32) -> usize;
    fn CGDisplayIsMain(display: u32) -> u8;
    fn CGDisplayBounds(display: u32) -> CGRect;
}

// ---- Shared types ----

#[derive(Serialize, Clone, Debug)]
pub struct DisplayInfo {
    pub index: u32,
    pub width: usize,
    pub height: usize,
    pub is_main: bool,
    pub screen_x: f64,
    pub screen_y: f64,
    pub screen_width: f64,
    pub screen_height: f64,
}

// ---- Display enumeration ----

#[cfg(target_os = "macos")]
pub fn get_displays() -> Vec<DisplayInfo> {
    let mut display_ids = [0u32; 16];
    let mut count: u32 = 0;
    let result = unsafe {
        CGGetActiveDisplayList(16, display_ids.as_mut_ptr(), &mut count)
    };
    if result != 0 {
        return vec![];
    }
    (0..count as usize)
        .map(|i| {
            let id = display_ids[i];
            let bounds = unsafe { CGDisplayBounds(id) };
            DisplayInfo {
                index: (i + 1) as u32,
                width: unsafe { CGDisplayPixelsWide(id) },
                height: unsafe { CGDisplayPixelsHigh(id) },
                is_main: unsafe { CGDisplayIsMain(id) } != 0,
                screen_x: bounds.origin.x,
                screen_y: bounds.origin.y,
                screen_width: bounds.size.width,
                screen_height: bounds.size.height,
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
pub fn get_displays() -> Vec<DisplayInfo> {
    use xcap::Monitor;
    let monitors = Monitor::all().unwrap_or_default();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| DisplayInfo {
            index: (i + 1) as u32,
            width: m.width() as usize,
            height: m.height() as usize,
            is_main: m.is_primary(),
            screen_x: m.x() as f64,
            screen_y: m.y() as f64,
            screen_width: m.width() as f64,
            screen_height: m.height() as f64,
        })
        .collect()
}

#[cfg(target_os = "linux")]
pub fn get_displays() -> Vec<DisplayInfo> {
    use xcap::Monitor;
    let monitors = Monitor::all().unwrap_or_default();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| DisplayInfo {
            index: (i + 1) as u32,
            width: m.width() as usize,
            height: m.height() as usize,
            is_main: m.is_primary(),
            screen_x: m.x() as f64,
            screen_y: m.y() as f64,
            screen_width: m.width() as f64,
            screen_height: m.height() as f64,
        })
        .collect()
}

// ---- Screenshot capture ----

fn encode_png_to_base64(path: &str) -> Result<String, String> {
    let image_data = std::fs::read(path).map_err(|e| e.to_string())?;
    let base64_data = STANDARD.encode(&image_data);
    std::fs::remove_file(path).ok();
    Ok(format!("data:image/png;base64,{}", base64_data))
}

#[cfg(not(target_os = "macos"))]
fn encode_image_to_base64(img: &image::RgbaImage) -> Result<String, String> {
    use std::io::Cursor;
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let base64_data = STANDARD.encode(buf.into_inner());
    Ok(format!("data:image/png;base64,{}", base64_data))
}

// ---- macOS: uses native screencapture CLI ----

#[cfg(target_os = "macos")]
pub async fn take_screenshot(window: tauri::Window) -> Result<String, String> {
    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    let temp_path = format!("/tmp/shotty_capture_{}.png", uuid::Uuid::new_v4());

    let _output = Command::new("screencapture")
        .args(["-i", "-x", &temp_path])
        .output()
        .map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    if !std::path::Path::new(&temp_path).exists() {
        return Err("Screenshot cancelled".to_string());
    }

    encode_png_to_base64(&temp_path)
}

#[cfg(target_os = "macos")]
pub async fn take_fullscreen(window: tauri::Window, display: u32) -> Result<String, String> {
    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    let temp_path = format!("/tmp/shotty_capture_{}.png", uuid::Uuid::new_v4());
    let display_str = display.to_string();

    let _output = Command::new("screencapture")
        .args(["-x", "-D", &display_str, &temp_path])
        .output()
        .map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    if !std::path::Path::new(&temp_path).exists() {
        return Err("Screenshot failed".to_string());
    }

    encode_png_to_base64(&temp_path)
}

// ---- Windows: uses xcap crate ----

#[cfg(target_os = "windows")]
pub async fn take_screenshot(window: tauri::Window) -> Result<String, String> {
    use xcap::Monitor;

    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    // Capture primary monitor (region selection handled by frontend)
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let primary = monitors
        .iter()
        .find(|m| m.is_primary())
        .or_else(|| monitors.first())
        .ok_or("No monitors found")?;

    let img = primary.capture_image().map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    encode_image_to_base64(&img)
}

#[cfg(target_os = "windows")]
pub async fn take_fullscreen(window: tauri::Window, display: u32) -> Result<String, String> {
    use xcap::Monitor;

    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let index = (display as usize).saturating_sub(1);
    let monitor = monitors
        .get(index)
        .ok_or("Display not found")?;

    let img = monitor.capture_image().map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    encode_image_to_base64(&img)
}

// ---- Linux: uses xcap crate (same approach as Windows) ----

#[cfg(target_os = "linux")]
pub async fn take_screenshot(window: tauri::Window) -> Result<String, String> {
    use xcap::Monitor;

    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let primary = monitors
        .iter()
        .find(|m| m.is_primary())
        .or_else(|| monitors.first())
        .ok_or("No monitors found")?;

    let img = primary.capture_image().map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    encode_image_to_base64(&img)
}

#[cfg(target_os = "linux")]
pub async fn take_fullscreen(window: tauri::Window, display: u32) -> Result<String, String> {
    use xcap::Monitor;

    window.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let index = (display as usize).saturating_sub(1);
    let monitor = monitors
        .get(index)
        .ok_or("Display not found")?;

    let img = monitor.capture_image().map_err(|e| e.to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    encode_image_to_base64(&img)
}
