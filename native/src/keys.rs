//! Modifier keys, left and right kept apart. Names are W3C `KeyboardEvent.code` names, so the same
//! trigger reads the same on both systems: Alt is Option on the Mac and Meta is Win / Cmd.

pub const SHIFT_LEFT: u32 = 1 << 0;
pub const SHIFT_RIGHT: u32 = 1 << 1;
pub const CONTROL_LEFT: u32 = 1 << 2;
pub const CONTROL_RIGHT: u32 = 1 << 3;
pub const ALT_LEFT: u32 = 1 << 4;
pub const ALT_RIGHT: u32 = 1 << 5;
pub const META_LEFT: u32 = 1 << 6;
pub const META_RIGHT: u32 = 1 << 7;

const NAMES: [(&str, u32); 8] = [
    ("ShiftLeft", SHIFT_LEFT),
    ("ShiftRight", SHIFT_RIGHT),
    ("ControlLeft", CONTROL_LEFT),
    ("ControlRight", CONTROL_RIGHT),
    ("AltLeft", ALT_LEFT),
    ("AltRight", ALT_RIGHT),
    ("MetaLeft", META_LEFT),
    ("MetaRight", META_RIGHT),
];

pub fn modifier_bit(name: &str) -> Option<u32> {
    NAMES.iter().find(|(n, _)| *n == name).map(|(_, bit)| *bit)
}

/// One hotkey the helper owns. `key` is the platform's physical key code.
pub struct Hotkey {
    pub id: String,
    pub mods: u32,
    pub key: u32,
}

/// What a key press means for abbreviations.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyClass {
    /// Types a character.
    Char,
    /// Space or Tab: an abbreviation typed just before fires.
    End(&'static str),
    Backspace,
    /// Anything else (arrows, Enter, Escape...): the caret may be somewhere else now.
    Other,
}

pub fn key_class(name: &str) -> KeyClass {
    let numbered = |prefix: &str, len: usize| name.len() == len && name.starts_with(prefix);
    match name {
        "Space" => KeyClass::End("space"),
        "Tab" => KeyClass::End("tab"),
        "Backspace" => KeyClass::Backspace,
        "Minus" | "Equal" | "BracketLeft" | "BracketRight" | "Backslash" | "Semicolon" | "Quote"
        | "Backquote" | "Comma" | "Period" | "Slash" | "IntlBackslash" => KeyClass::Char,
        _ if numbered("Key", 4) || numbered("Digit", 6) || numbered("Numpad", 7) => KeyClass::Char,
        _ => KeyClass::Other,
    }
}
