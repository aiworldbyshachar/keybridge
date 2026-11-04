//! Windows: a low-level keyboard hook (WH_KEYBOARD_LL) that sees left and right modifiers as
//! different keys, SendInput for typing, and the clipboard for pasting.

use crate::keys::*;
use serde_json::{json, Value};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering::SeqCst};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Globalization::LCIDToLocaleName;
use windows_sys::Win32::System::DataExchange::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Memory::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

pub const NAME: &str = "windows";

/// dwExtraInfo on everything we inject, so our own hook lets it pass untouched.
const OUR_INPUT: usize = 0x4B42_5247;
/// dwExtraInfo the self-test uses: the hook treats it like a real key press.
const SELFTEST_INPUT: usize = 0x4B42_5354;

const CF_UNICODETEXT: u32 = 13;
/// Markers that ask clipboard tools (ClipBridge, Windows clipboard history) to skip our content.
const CLIPBOARD_MARKERS: [&str; 4] = [
    "ExcludeClipboardContentFromMonitorProcessing",
    "Clipboard Viewer Ignore",
    "CanIncludeInClipboardHistory",
    "CanUploadToCloudClipboard",
];
/// How long the target app gets to read the clipboard before the old content comes back.
const PASTE_SETTLE: Duration = Duration::from_millis(400);

static HOTKEYS: Mutex<Vec<Hotkey>> = Mutex::new(Vec::new());
/// Modifiers physically held, from the hook (our own injected keys don't count).
static MODS: AtomicU32 = AtomicU32::new(0);
static PAUSED: AtomicBool = AtomicBool::new(false);
/// Keys whose down event we swallowed, so their up event (and auto-repeat) is swallowed too.
static SWALLOWED: [AtomicBool; 512] = [const { AtomicBool::new(false) }; 512];
static EVENTS: OnceLock<mpsc::Sender<String>> = OnceLock::new();
/// A message-only window on the hook thread: the clipboard needs an owner window that pumps messages.
static CLIP_WINDOW: AtomicUsize = AtomicUsize::new(0);
/// Counts only (never which keys) - used by the self-test.
static FIRED: AtomicU32 = AtomicU32::new(0);
static SWALLOW_COUNT: AtomicU32 = AtomicU32::new(0);

const ALT_OR_META: u32 = ALT_LEFT | ALT_RIGHT | META_LEFT | META_RIGHT;

/// (bit, virtual key, scan code, extended) for each modifier.
const MOD_KEYS: [(u32, u16, u16, bool); 8] = [
    (SHIFT_LEFT, 0xA0, 0x2A, false),
    (SHIFT_RIGHT, 0xA1, 0x36, false),
    (CONTROL_LEFT, 0xA2, 0x1D, false),
    (CONTROL_RIGHT, 0xA3, 0x1D, true),
    (ALT_LEFT, 0xA4, 0x38, false),
    (ALT_RIGHT, 0xA5, 0x38, true),
    (META_LEFT, 0x5B, 0x5B, true),
    (META_RIGHT, 0x5C, 0x5C, true),
];

/// Physical keys (W3C names) as set-1 scan codes; 0x100 marks an extended (E0) key.
const SCAN_CODES: &[(&str, u32)] = &[
    ("Escape", 0x01), ("Digit1", 0x02), ("Digit2", 0x03), ("Digit3", 0x04), ("Digit4", 0x05),
    ("Digit5", 0x06), ("Digit6", 0x07), ("Digit7", 0x08), ("Digit8", 0x09), ("Digit9", 0x0A),
    ("Digit0", 0x0B), ("Minus", 0x0C), ("Equal", 0x0D), ("Backspace", 0x0E), ("Tab", 0x0F),
    ("KeyQ", 0x10), ("KeyW", 0x11), ("KeyE", 0x12), ("KeyR", 0x13), ("KeyT", 0x14),
    ("KeyY", 0x15), ("KeyU", 0x16), ("KeyI", 0x17), ("KeyO", 0x18), ("KeyP", 0x19),
    ("BracketLeft", 0x1A), ("BracketRight", 0x1B), ("Enter", 0x1C),
    ("KeyA", 0x1E), ("KeyS", 0x1F), ("KeyD", 0x20), ("KeyF", 0x21), ("KeyG", 0x22),
    ("KeyH", 0x23), ("KeyJ", 0x24), ("KeyK", 0x25), ("KeyL", 0x26), ("Semicolon", 0x27),
    ("Quote", 0x28), ("Backquote", 0x29), ("Backslash", 0x2B),
    ("KeyZ", 0x2C), ("KeyX", 0x2D), ("KeyC", 0x2E), ("KeyV", 0x2F), ("KeyB", 0x30),
    ("KeyN", 0x31), ("KeyM", 0x32), ("Comma", 0x33), ("Period", 0x34), ("Slash", 0x35),
    ("NumpadMultiply", 0x37), ("Space", 0x39), ("CapsLock", 0x3A),
    ("F1", 0x3B), ("F2", 0x3C), ("F3", 0x3D), ("F4", 0x3E), ("F5", 0x3F), ("F6", 0x40),
    ("F7", 0x41), ("F8", 0x42), ("F9", 0x43), ("F10", 0x44), ("F11", 0x57), ("F12", 0x58),
    ("F13", 0x64), ("F14", 0x65), ("F15", 0x66), ("F16", 0x67), ("F17", 0x68), ("F18", 0x69),
    ("F19", 0x6A), ("F20", 0x6B), ("F21", 0x6C), ("F22", 0x6D), ("F23", 0x6E), ("F24", 0x76),
    ("ScrollLock", 0x46), ("Numpad7", 0x47), ("Numpad8", 0x48), ("Numpad9", 0x49),
    ("NumpadSubtract", 0x4A), ("Numpad4", 0x4B), ("Numpad5", 0x4C), ("Numpad6", 0x4D),
    ("NumpadAdd", 0x4E), ("Numpad1", 0x4F), ("Numpad2", 0x50), ("Numpad3", 0x51),
    ("Numpad0", 0x52), ("NumpadDecimal", 0x53), ("IntlBackslash", 0x56),
    ("NumpadEnter", 0x11C), ("NumpadDivide", 0x135), ("PrintScreen", 0x137), ("Home", 0x147),
    ("ArrowUp", 0x148), ("PageUp", 0x149), ("ArrowLeft", 0x14B), ("ArrowRight", 0x14D),
    ("End", 0x14F), ("ArrowDown", 0x150), ("PageDown", 0x151), ("Insert", 0x152),
    ("Delete", 0x153), ("ContextMenu", 0x15D), ("NumLock", 0x145),
];

pub fn key_code(name: &str) -> Option<u32> {
    SCAN_CODES.iter().find(|(n, _)| *n == name).map(|(_, sc)| *sc)
}

pub fn set_hotkeys(list: Vec<Hotkey>) {
    *HOTKEYS.lock().unwrap() = list;
}

pub fn set_paused(paused: bool) {
    PAUSED.store(paused, SeqCst);
}

/// Installs the hook on its own thread (it needs a message loop) and waits until it's in place.
pub fn start(events: mpsc::Sender<String>) -> Result<(), String> {
    let _ = EVENTS.set(events);
    let (ready, started) = mpsc::channel();
    std::thread::spawn(move || unsafe {
        let module = GetModuleHandleW(null());
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0);
        let class = wide("STATIC");
        let window = CreateWindowExW(0, class.as_ptr(), null(), 0, 0, 0, 0, 0, HWND_MESSAGE, null_mut(), module, null());
        CLIP_WINDOW.store(window as usize, SeqCst);
        let _ = ready.send(if hook.is_null() {
            Err(format!("could not install the keyboard hook (error {})", GetLastError()))
        } else {
            Ok(())
        });
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
    started.recv().map_err(|e| e.to_string())?
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let ev = &*(lparam as *const KBDLLHOOKSTRUCT);
        if ev.dwExtraInfo != OUR_INPUT && on_key(ev, wparam as u32) {
            SWALLOW_COUNT.fetch_add(1, SeqCst);
            return 1;
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

/// Decides one key event. Returns true to swallow it. Must stay fast: Windows drops slow hooks.
fn on_key(ev: &KBDLLHOOKSTRUCT, msg: u32) -> bool {
    let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    // AltGr sends a fake Left Ctrl (scan code 0x21D) ahead of Right Alt - it isn't a real key press.
    if ev.vkCode == VK_LCONTROL as u32 && ev.scanCode == 0x21D {
        return false;
    }
    if let Some(bit) = modifier_bit_of(ev) {
        if down {
            MODS.fetch_or(bit, SeqCst);
        } else {
            MODS.fetch_and(!bit, SeqCst);
        }
        return false;
    }

    let key = key_id(ev);
    if !down {
        return SWALLOWED[key].swap(false, SeqCst);
    }
    if SWALLOWED[key].load(SeqCst) {
        return true; // auto-repeat of a hotkey we already took
    }
    if PAUSED.load(SeqCst) {
        return false;
    }
    let mods = held_modifiers();
    let id = {
        let hotkeys = HOTKEYS.lock().unwrap();
        hotkeys.iter().find(|h| h.key == key as u32 && h.mods == mods).map(|h| h.id.clone())
    };
    let Some(id) = id else { return false };
    SWALLOWED[key].store(true, SeqCst);
    FIRED.fetch_add(1, SeqCst);
    if let Some(events) = EVENTS.get() {
        let _ = events.send(json!({"event": "hotkey", "id": id}).to_string());
    }
    true
}

fn modifier_bit_of(ev: &KBDLLHOOKSTRUCT) -> Option<u32> {
    let extended = ev.flags & LLKHF_EXTENDED != 0;
    let side = |left, right| Some(if extended { right } else { left });
    match ev.vkCode as u16 {
        0xA0 => Some(SHIFT_LEFT),
        0xA1 => Some(SHIFT_RIGHT),
        0xA2 => Some(CONTROL_LEFT),
        0xA3 => Some(CONTROL_RIGHT),
        0xA4 => Some(ALT_LEFT),
        0xA5 => Some(ALT_RIGHT),
        0x5B => Some(META_LEFT),
        0x5C => Some(META_RIGHT),
        // generic codes, sent by some tools that inject keys
        0x10 => Some(if ev.scanCode == 0x36 { SHIFT_RIGHT } else { SHIFT_LEFT }),
        0x11 => side(CONTROL_LEFT, CONTROL_RIGHT),
        0x12 => side(ALT_LEFT, ALT_RIGHT),
        _ => None,
    }
}

fn key_id(ev: &KBDLLHOOKSTRUCT) -> usize {
    let mut scan = ev.scanCode & 0xFF;
    if scan == 0 {
        scan = unsafe { MapVirtualKeyW(ev.vkCode, MAPVK_VK_TO_VSC) } & 0xFF;
    }
    let extended = if ev.flags & LLKHF_EXTENDED != 0 { 0x100 } else { 0 };
    (scan | extended) as usize & 0x1FF
}

/// The tracked modifiers, minus any Windows says aren't down (a key-up we never saw, e.g. during
/// a UAC prompt or the lock screen, would otherwise leave a modifier stuck).
fn held_modifiers() -> u32 {
    let mut mods = MODS.load(SeqCst);
    for (bit, vk, _, _) in MOD_KEYS {
        if mods & bit != 0 && unsafe { GetAsyncKeyState(vk as i32) } >= 0 {
            mods &= !bit;
        }
    }
    MODS.store(mods, SeqCst);
    mods
}

fn key_input(vk: u16, scan: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: OUR_INPUT },
        },
    }
}

fn tap(inputs: &mut Vec<INPUT>, vk: u16, scan: u16) {
    inputs.push(key_input(vk, scan, 0));
    inputs.push(key_input(vk, scan, KEYEVENTF_KEYUP));
}

fn send(inputs: &[INPUT]) -> bool {
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    sent as usize == inputs.len()
}

/// Sends `body` with the user's held modifiers lifted, so Right Shift still held from the hotkey
/// doesn't turn the typed text into capitals or Ctrl+V into Ctrl+Shift+V. Modifiers still held
/// afterwards are pressed again, so the keyboard ends up in the state the user is in.
fn send_without_modifiers(body: &[INPUT]) -> bool {
    let held = MODS.load(SeqCst);
    let mut inputs = Vec::new();
    if held & ALT_OR_META != 0 {
        // a lone Alt or Win release would open the menu bar or the Start menu - tap an unused key first
        tap(&mut inputs, 0xE8, 0);
    }
    for (bit, vk, scan, extended) in MOD_KEYS {
        if held & bit != 0 {
            let ext = if extended { KEYEVENTF_EXTENDEDKEY } else { 0 };
            inputs.push(key_input(vk, scan, KEYEVENTF_KEYUP | ext));
        }
    }
    inputs.extend_from_slice(body);
    let ok = send(&inputs);

    let still = MODS.load(SeqCst) & held;
    let mut again = Vec::new();
    for (bit, vk, scan, extended) in MOD_KEYS {
        if still & bit != 0 {
            again.push(key_input(vk, scan, if extended { KEYEVENTF_EXTENDEDKEY } else { 0 }));
        }
    }
    if !again.is_empty() {
        send(&again);
    }
    ok
}

const BLOCKED: &str = "Windows blocked the keys (the app in front may run as administrator)";

pub fn type_text(text: &str) -> Result<(), String> {
    let mut body = Vec::new();
    for ch in text.chars() {
        match ch {
            '\r' => {}
            '\n' => tap(&mut body, VK_RETURN, 0x1C),
            '\t' => tap(&mut body, VK_TAB, 0x0F),
            _ => {
                let mut units = [0u16; 2];
                for unit in ch.encode_utf16(&mut units) {
                    body.push(key_input(0, *unit, KEYEVENTF_UNICODE));
                    body.push(key_input(0, *unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                }
            }
        }
    }
    if send_without_modifiers(&body) { Ok(()) } else { Err(BLOCKED.into()) }
}

pub fn paste_text(text: &str) -> Result<(), String> {
    let saved = clipboard::save()?;
    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0);
    let bytes: Vec<u8> = utf16.iter().flat_map(|u| u.to_le_bytes()).collect();
    clipboard::write(&[(CF_UNICODETEXT, bytes)])?;

    let mut ctrl_v = vec![key_input(VK_LCONTROL, 0x1D, 0)];
    tap(&mut ctrl_v, 0x56, 0x2F);
    ctrl_v.push(key_input(VK_LCONTROL, 0x1D, KEYEVENTF_KEYUP));
    let sent = send_without_modifiers(&ctrl_v);

    std::thread::sleep(PASTE_SETTLE);
    clipboard::write(&saved)?;
    if sent { Ok(()) } else { Err(BLOCKED.into()) }
}

/// The keyboard layout of the window in front, e.g. {"langId":"040D","locale":"he-IL"}.
pub fn layout() -> Value {
    unsafe {
        let thread = GetWindowThreadProcessId(GetForegroundWindow(), null_mut());
        let lang = (GetKeyboardLayout(thread) as usize & 0xFFFF) as u32;
        let mut name = [0u16; 85];
        let len = LCIDToLocaleName(lang, name.as_mut_ptr(), name.len() as i32, 0);
        let locale = String::from_utf16_lossy(&name[..(len.max(1) - 1) as usize]);
        json!({"event": "layout", "langId": format!("{lang:04X}"), "locale": locale})
    }
}

mod clipboard {
    use super::*;

    /// Formats whose handle is plain memory we can copy; GDI handles (bitmaps, metafiles,
    /// palettes) are skipped - their memory twins (CF_DIB etc.) cover the same content.
    fn is_memory_format(format: u32) -> bool {
        !matches!(format, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E | 0x300..=0x3FF)
    }

    struct Open;
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    fn open() -> Result<Open, String> {
        let owner = CLIP_WINDOW.load(SeqCst) as HWND;
        for _ in 0..20 {
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(Open);
            }
            std::thread::sleep(Duration::from_millis(15)); // another app has it open right now
        }
        Err("the clipboard is busy".into())
    }

    pub fn save() -> Result<Vec<(u32, Vec<u8>)>, String> {
        let _open = open()?;
        let mut saved = Vec::new();
        let mut format = 0;
        loop {
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if !is_memory_format(format) {
                continue;
            }
            unsafe {
                let handle = GetClipboardData(format);
                if handle.is_null() {
                    continue;
                }
                let size = GlobalSize(handle);
                let data = GlobalLock(handle) as *const u8;
                if data.is_null() {
                    continue;
                }
                saved.push((format, std::slice::from_raw_parts(data, size).to_vec()));
                GlobalUnlock(handle);
            }
        }
        Ok(saved)
    }

    /// Replaces the clipboard with `items` plus the markers that tell clipboard tools to skip it.
    /// Also used to put the user's content back, so ClipBridge doesn't record it a second time.
    pub fn write(items: &[(u32, Vec<u8>)]) -> Result<(), String> {
        let _open = open()?;
        unsafe { EmptyClipboard() };
        for (format, bytes) in items {
            set(*format, bytes)?;
        }
        for name in CLIPBOARD_MARKERS {
            let format = unsafe { RegisterClipboardFormatW(wide(name).as_ptr()) };
            if format != 0 && !items.iter().any(|(f, _)| *f == format) {
                set(format, &0u32.to_le_bytes())?;
            }
        }
        Ok(())
    }

    fn set(format: u32, bytes: &[u8]) -> Result<(), String> {
        unsafe {
            let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
            if memory.is_null() {
                return Err("out of memory".into());
            }
            let data = GlobalLock(memory) as *mut u8;
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len());
            GlobalUnlock(memory);
            if SetClipboardData(format, memory as HANDLE).is_null() {
                GlobalFree(memory);
                return Err(format!("could not set clipboard format {format}"));
            }
        }
        Ok(())
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Injects Right Shift + F24 (a key no app reacts to) and Left Shift + F24 with a hotkey on
/// Right Shift + F24, and checks the first was taken and swallowed and the second passed.
pub fn selftest() -> i32 {
    let (events, received) = mpsc::channel();
    if let Err(e) = start(events) {
        println!("{}", json!({"selftest": "fail", "reason": e}));
        return 1;
    }
    let f24 = key_code("F24").unwrap();
    set_hotkeys(vec![Hotkey { id: "selftest".into(), mods: SHIFT_RIGHT, key: f24 }]);

    let fake = |vk: u16, scan: u16, flags: u32| {
        let mut input = key_input(vk, scan, flags);
        input.Anonymous.ki.dwExtraInfo = SELFTEST_INPUT;
        input
    };
    let (f24_vk, f24_scan) = (VK_F24, f24 as u16);
    let press = |shift_vk: u16, shift_scan: u16| {
        send(&[
            fake(shift_vk, shift_scan, 0),
            fake(f24_vk, f24_scan, 0),
            fake(f24_vk, f24_scan, KEYEVENTF_KEYUP),
            fake(shift_vk, shift_scan, KEYEVENTF_KEYUP),
        ])
    };
    let sent = press(0xA1, 0x36) && press(0xA0, 0x2A);
    let event = received.recv_timeout(Duration::from_secs(2)).ok();
    std::thread::sleep(Duration::from_millis(300));

    let fired = FIRED.load(SeqCst);
    let swallowed = SWALLOW_COUNT.load(SeqCst);
    let ok = sent && fired == 1 && swallowed == 2 && event.as_deref().is_some_and(|e| e.contains("selftest"));
    println!(
        "{}",
        json!({"selftest": if ok { "pass" } else { "fail" }, "sent": sent, "fired": fired, "swallowed": swallowed, "event": event})
    );
    if ok { 0 } else { 1 }
}
