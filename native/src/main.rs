//! KeyBridge keyboard helper.
//!
//! Listens for hotkeys with left and right modifier keys told apart and for abbreviations, swallows
//! the ones it owns, and types or pastes text. Talks JSON lines: commands on stdin, events on
//! stdout. It never logs or stores keystrokes - the only thing it reports about the keyboard is
//! "hotkey <id> fired" or "abbreviation <id> fired".
//!
//! Commands:
//!   {"cmd":"setHotkeys","hotkeys":[{"id":"addr","mods":["ShiftRight"],"key":"KeyA"}]}
//!   {"cmd":"setAbbrevs","abbrevs":[{"id":"addr","keys":["Semicolon","KeyA","Shift+KeyD"],"word":false}]}
//!   {"cmd":"type","text":"...","erase":0,"left":0}   short text, typed as Unicode (any layout, any
//!                                   language), after `erase` Backspaces; then the caret moves `left`
//!   {"cmd":"paste","text":"...","erase":0,"left":0}  long text, pasted; the clipboard comes back after
//!   {"cmd":"pause","paused":true}
//!   {"cmd":"record","on":true}     the next key press (with its modifiers) is reported, not typed
//!   {"cmd":"layout"}                the keyboard layout of the window in front
//!   {"cmd":"quit"}
//! Events: ready, hotkeysSet, abbrevsSet, hotkey, abbrev {id, erase, end}, recorded {mods, key},
//! done, layout, permission (macOS), error.

mod abbrev;
mod keys;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

#[cfg(target_os = "macos")]
use mac as platform;
#[cfg(windows)]
use win as platform;

#[cfg(not(any(windows, target_os = "macos")))]
compile_error!("the KeyBridge helper runs on Windows and macOS");

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::mpsc;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    if std::env::args().any(|a| a == "--selftest") {
        std::process::exit(platform::selftest());
    }

    let (events, outbox) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        for line in outbox {
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        }
    });

    if let Err(e) = platform::start(events.clone()) {
        let _ = events.send(json!({"event": "error", "message": e}).to_string());
        std::thread::sleep(std::time::Duration::from_millis(100));
        std::process::exit(1);
    }
    let _ = events.send(json!({"event": "ready", "platform": platform::NAME, "version": VERSION}).to_string());

    // stdin closing means the app is gone, so the helper goes too.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(cmd) => handle(&cmd),
            Err(e) => json!({"event": "error", "message": format!("bad JSON: {e}")}),
        };
        let _ = events.send(reply.to_string());
    }
}

fn handle(cmd: &Value) -> Value {
    let name = cmd["cmd"].as_str().unwrap_or("");
    let text = cmd["text"].as_str().unwrap_or("");
    let count = |field: &str, max: u64| cmd[field].as_u64().unwrap_or(0).min(max) as usize;
    let (erase, left) = (count("erase", abbrev::MAX_KEYS as u64), count("left", 100_000));
    let done = |result: Result<(), String>| match result {
        Ok(()) => json!({"event": "done", "cmd": name}),
        Err(e) => json!({"event": "error", "cmd": name, "message": e}),
    };
    match name {
        "setHotkeys" => {
            let (hotkeys, skipped) = parse_hotkeys(&cmd["hotkeys"]);
            let count = hotkeys.len();
            platform::set_hotkeys(hotkeys);
            json!({"event": "hotkeysSet", "count": count, "skipped": skipped})
        }
        "setAbbrevs" => {
            let (abbrevs, skipped) = parse_abbrevs(&cmd["abbrevs"]);
            let count = abbrevs.len();
            platform::set_abbrevs(abbrevs);
            json!({"event": "abbrevsSet", "count": count, "skipped": skipped})
        }
        "type" => done(platform::type_text(text, erase, left)),
        "paste" => done(platform::paste_text(text, erase, left)),
        "pause" => {
            platform::set_paused(cmd["paused"].as_bool().unwrap_or(true));
            json!({"event": "done", "cmd": name})
        }
        "record" => {
            platform::set_recording(cmd["on"].as_bool().unwrap_or(true));
            json!({"event": "done", "cmd": name})
        }
        "layout" => platform::layout(),
        "quit" => std::process::exit(0),
        _ => json!({"event": "error", "message": format!("unknown command: {name}")}),
    }
}

/// Turns the JSON hotkey list into platform hotkeys; ids with an unknown key or modifier are skipped.
fn parse_hotkeys(list: &Value) -> (Vec<keys::Hotkey>, Vec<String>) {
    let mut hotkeys = Vec::new();
    let mut skipped = Vec::new();
    for item in list.as_array().into_iter().flatten() {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let key = item["key"].as_str().and_then(platform::key_code);
        let mut mods = Some(0);
        for m in item["mods"].as_array().into_iter().flatten() {
            mods = match (mods, m.as_str().and_then(keys::modifier_bit)) {
                (Some(acc), Some(bit)) => Some(acc | bit),
                _ => None,
            };
        }
        match (key, mods) {
            (Some(key), Some(mods)) if !id.is_empty() => hotkeys.push(keys::Hotkey { id, mods, key }),
            _ => skipped.push(id),
        }
    }
    (hotkeys, skipped)
}

/// Turns the JSON abbreviation list into key sequences ("Shift+KeyA" = A with Shift held); ids
/// with an unknown key are skipped.
fn parse_abbrevs(list: &Value) -> (Vec<abbrev::Abbrev>, Vec<String>) {
    let mut abbrevs = Vec::new();
    let mut skipped = Vec::new();
    for item in list.as_array().into_iter().flatten() {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let strokes = item["keys"].as_array().and_then(|names| {
            names
                .iter()
                .map(|name| {
                    let name = name.as_str()?;
                    let (shift, name) = match name.strip_prefix("Shift+") {
                        Some(rest) => (true, rest),
                        None => (false, name),
                    };
                    platform::key_code(name).map(|key| abbrev::Stroke { key, shift })
                })
                .collect::<Option<Vec<_>>>()
        });
        match strokes {
            Some(keys) if !id.is_empty() && !keys.is_empty() && keys.len() <= abbrev::MAX_KEYS => {
                abbrevs.push(abbrev::Abbrev { id, keys, word: item["word"].as_bool().unwrap_or(false) })
            }
            _ => skipped.push(id),
        }
    }
    (abbrevs, skipped)
}
