//! KeyBridge keyboard helper.
//!
//! Listens for hotkeys with left and right modifier keys told apart, swallows the ones it owns, and
//! types or pastes text. Talks JSON lines: commands on stdin, events on stdout. It never logs or
//! stores keystrokes - the only thing it reports about the keyboard is "hotkey <id> fired".
//!
//! Commands:
//!   {"cmd":"setHotkeys","hotkeys":[{"id":"addr","mods":["ShiftRight"],"key":"KeyA"}]}
//!   {"cmd":"type","text":"..."}     short text, typed as Unicode (any layout, any language)
//!   {"cmd":"paste","text":"..."}    long text, pasted; the previous clipboard comes back after
//!   {"cmd":"pause","paused":true}
//!   {"cmd":"layout"}                the keyboard layout of the window in front
//!   {"cmd":"quit"}
//! Events: ready, hotkeysSet, hotkey, done, layout, error.

#![cfg_attr(not(windows), allow(unused))]

mod keys;
#[cfg(windows)]
mod win;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::mpsc;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(windows)]
fn main() {
    if std::env::args().any(|a| a == "--selftest") {
        std::process::exit(win::selftest());
    }

    let (events, outbox) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        for line in outbox {
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        }
    });

    if let Err(e) = win::start(events.clone()) {
        let _ = events.send(json!({"event": "error", "message": e}).to_string());
        std::thread::sleep(std::time::Duration::from_millis(100));
        std::process::exit(1);
    }
    let _ = events.send(json!({"event": "ready", "platform": "windows", "version": VERSION}).to_string());

    // stdin closing means the app is gone, so the helper goes too.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(cmd) => handle(&cmd),
            Err(e) => Some(json!({"event": "error", "message": format!("bad JSON: {e}")})),
        };
        if let Some(reply) = reply {
            let _ = events.send(reply.to_string());
        }
    }
}

#[cfg(windows)]
fn handle(cmd: &Value) -> Option<Value> {
    let name = cmd["cmd"].as_str().unwrap_or("");
    let text = cmd["text"].as_str().unwrap_or("");
    let done = |result: Result<(), String>| match result {
        Ok(()) => json!({"event": "done", "cmd": name}),
        Err(e) => json!({"event": "error", "cmd": name, "message": e}),
    };
    Some(match name {
        "setHotkeys" => {
            let (hotkeys, skipped) = parse_hotkeys(&cmd["hotkeys"]);
            let count = hotkeys.len();
            win::set_hotkeys(hotkeys);
            json!({"event": "hotkeysSet", "count": count, "skipped": skipped})
        }
        "type" => done(win::type_text(text)),
        "paste" => done(win::paste_text(text)),
        "pause" => {
            win::set_paused(cmd["paused"].as_bool().unwrap_or(true));
            json!({"event": "done", "cmd": name})
        }
        "layout" => win::layout(),
        "quit" => std::process::exit(0),
        _ => json!({"event": "error", "message": format!("unknown command: {name}")}),
    })
}

/// Turns the JSON hotkey list into platform hotkeys; ids with an unknown key or modifier are skipped.
#[cfg(windows)]
fn parse_hotkeys(list: &Value) -> (Vec<keys::Hotkey>, Vec<String>) {
    let mut hotkeys = Vec::new();
    let mut skipped = Vec::new();
    for item in list.as_array().into_iter().flatten() {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let key = item["key"].as_str().and_then(win::key_code);
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

#[cfg(not(windows))]
fn main() {
    eprintln!("keybridge-helper: the macOS part comes after the Windows spike");
    std::process::exit(1);
}
