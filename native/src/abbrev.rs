//! Abbreviations: the last few typed keys, compared with the abbreviations on each Space or Tab.
//!
//! Keys are physical, so ";addr" fires on whichever layout it was typed. The typed keys exist only
//! in this buffer, in memory: at most MAX_KEYS of them, kept only while there are abbreviations,
//! dropped on any other key, and never written anywhere or sent out - only "abbreviation <id>
//! fired" is.

use crate::keys::KeyClass;
use std::collections::VecDeque;

pub const MAX_KEYS: usize = 32;

/// One key press: the platform's physical key code and whether Shift was held.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Stroke {
    pub key: u32,
    pub shift: bool,
}

pub struct Abbrev {
    pub id: String,
    pub keys: Vec<Stroke>,
    /// Starts with a letter or digit: fires only as a whole word ("addr" not inside "myaddr").
    pub word: bool,
}

pub struct Fired {
    pub id: String,
    /// Characters to delete before the text goes in.
    pub erase: usize,
    pub end: &'static str,
}

pub struct Matcher {
    abbrevs: Vec<Abbrev>,
    typed: VecDeque<Stroke>,
    /// The first typed key isn't the start of a word (keys fell off, or Backspace went past it).
    clipped: bool,
}

impl Matcher {
    pub const fn new() -> Self {
        Matcher { abbrevs: Vec::new(), typed: VecDeque::new(), clipped: false }
    }

    pub fn set(&mut self, list: Vec<Abbrev>) {
        self.abbrevs = list;
        self.reset();
    }

    pub fn reset(&mut self) {
        self.typed.clear();
        self.clipped = false;
    }

    /// One key press with no Ctrl, Alt or Cmd held. Returns the abbreviation that fired, if any.
    pub fn press(&mut self, stroke: Stroke, class: KeyClass) -> Option<Fired> {
        if self.abbrevs.is_empty() {
            return None;
        }
        match class {
            KeyClass::Char => {
                if self.typed.len() == MAX_KEYS {
                    self.typed.pop_front();
                    self.clipped = true;
                }
                self.typed.push_back(stroke);
                None
            }
            KeyClass::Backspace => {
                if self.typed.pop_back().is_none() {
                    self.clipped = true;
                }
                None
            }
            KeyClass::End(end) => {
                let fired = self.find().map(|a| Fired { id: a.id.clone(), erase: a.keys.len(), end });
                self.reset();
                fired
            }
            KeyClass::Other => {
                self.reset();
                None
            }
        }
    }

    /// The longest abbreviation the typed keys end with.
    fn find(&self) -> Option<&Abbrev> {
        let typed = self.typed.len();
        self.abbrevs
            .iter()
            .filter(|a| {
                let n = a.keys.len();
                n > 0
                    && n <= typed
                    && (!a.word || (n == typed && !self.clipped))
                    && self.typed.iter().skip(typed - n).eq(a.keys.iter())
            })
            .max_by_key(|a| a.keys.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // made-up key codes
    const SEMI: u32 = 1;
    const A: u32 = 2;
    const D: u32 = 3;
    const R: u32 = 4;
    const H: u32 = 5;
    const I: u32 = 6;
    const X: u32 = 7;

    fn s(key: u32) -> Stroke {
        Stroke { key, shift: false }
    }

    fn matcher() -> Matcher {
        let mut m = Matcher::new();
        m.set(vec![
            Abbrev { id: "addr".into(), keys: vec![s(SEMI), s(A), s(D), s(D), s(R)], word: false },
            Abbrev { id: "hi".into(), keys: vec![s(H), s(I)], word: true },
        ]);
        m
    }

    fn type_keys(m: &mut Matcher, keys: &[u32]) {
        for k in keys {
            assert!(m.press(s(*k), KeyClass::Char).is_none());
        }
    }

    fn space(m: &mut Matcher) -> Option<String> {
        m.press(s(99), KeyClass::End("space")).map(|f| format!("{} {} {}", f.id, f.erase, f.end))
    }

    #[test]
    fn fires_on_space_with_what_to_erase() {
        let mut m = matcher();
        type_keys(&mut m, &[SEMI, A, D, D, R]);
        assert_eq!(space(&mut m).as_deref(), Some("addr 5 space"));
        let fired = { type_keys(&mut m, &[SEMI, A, D, D, R]); m.press(s(98), KeyClass::End("tab")) };
        assert_eq!(fired.map(|f| f.end), Some("tab"));
    }

    #[test]
    fn symbol_abbreviation_fires_after_other_letters() {
        let mut m = matcher();
        type_keys(&mut m, &[X, SEMI, A, D, D, R]);
        assert_eq!(space(&mut m).as_deref(), Some("addr 5 space"));
    }

    #[test]
    fn word_abbreviation_fires_only_as_a_whole_word() {
        let mut m = matcher();
        type_keys(&mut m, &[X, H, I]);
        assert_eq!(space(&mut m), None);
        type_keys(&mut m, &[H, I]);
        assert_eq!(space(&mut m).as_deref(), Some("hi 2 space"));
    }

    #[test]
    fn backspace_corrects_a_typo() {
        let mut m = matcher();
        type_keys(&mut m, &[SEMI, A, D, X]);
        assert!(m.press(s(0), KeyClass::Backspace).is_none());
        type_keys(&mut m, &[D, R]);
        assert_eq!(space(&mut m).as_deref(), Some("addr 5 space"));
    }

    #[test]
    fn backspace_past_the_start_is_not_a_word_start() {
        let mut m = matcher();
        m.press(s(0), KeyClass::Backspace);
        type_keys(&mut m, &[H, I]);
        assert_eq!(space(&mut m), None);
    }

    #[test]
    fn other_keys_start_over() {
        let mut m = matcher();
        type_keys(&mut m, &[SEMI, A, D]);
        m.press(s(50), KeyClass::Other);
        type_keys(&mut m, &[D, R]);
        assert_eq!(space(&mut m), None);
    }

    #[test]
    fn shift_is_part_of_the_key() {
        let mut m = matcher();
        type_keys(&mut m, &[SEMI, A, D, D]);
        m.press(Stroke { key: R, shift: true }, KeyClass::Char);
        assert_eq!(space(&mut m), None);
    }

    #[test]
    fn the_longest_abbreviation_wins() {
        let mut m = Matcher::new();
        m.set(vec![
            Abbrev { id: "short".into(), keys: vec![s(D), s(R)], word: false },
            Abbrev { id: "long".into(), keys: vec![s(A), s(D), s(D), s(R)], word: false },
        ]);
        type_keys(&mut m, &[A, D, D, R]);
        assert_eq!(space(&mut m).as_deref(), Some("long 4 space"));
    }

    #[test]
    fn keeps_nothing_without_abbreviations_and_little_with_them() {
        let mut m = Matcher::new();
        type_keys(&mut m, &[A, D, R]);
        assert!(m.typed.is_empty());
        let mut m = matcher();
        for _ in 0..100 {
            m.press(s(A), KeyClass::Char);
        }
        assert_eq!(m.typed.len(), MAX_KEYS);
        m.press(s(0), KeyClass::Other);
        assert!(m.typed.is_empty());
    }
}
