# Review - KeyBridge demo film

Checked with `hyperframes check` (passes, no errors), `snapshot --review` (scene starts and middles, every cut,
phone width) and about 35 QA frames from SPEC.md, several times while fixing. Storyline A (STORYLINES.md); B and C
were not built.

## Creative calls
- The real KeyBridge window is the app's own markup and stylesheet, not a redrawing: tools/grab-ui.cjs renders
  src/renderer with the preview's made-up data, tools/scope-ui.mjs scopes style.css to `.kb`, tools/inject-ui.mjs
  places each state (`npm run ui` refreshes all of it when the app changes).
- A Link shortcut opens its link, it doesn't type it, so the payoff reply gets the address and the signature only.
- The hook's Mac typing moved from a reply's To field (Dana writing to herself) to its last line, "You can reach
  me at", which the payoff repeats.
- The pause button left the privacy scene: the voice doesn't mention it and the scene had no room.
- The sign-in step skips the email link and goes straight to the code (the voice says "sign in and type your code").
- The language screens use English shortcut names except Hebrew, which gets Hebrew names.
- The music starts at 1.5 s so its pause falls on the cut to the sign-in scene and its last chord under the end card.

## Fixed during review
- Text set with `textContent` (and single `tl.set` attribute steps) did not undo when the film seeked backwards
  or a scene showed again: the address appeared before Right Shift + E in the preview's scrubbing. All changing
  text is now a `data-text` attribute drawn by CSS and changed by `swap()` tweens that state both sides; checked
  by snapshots taken in a jumbled order (85, 28.3, 29.4, 72, 48, 47.6, 40.6, 39.4, 65.9...).
- The film's keycap classes `.key` / `.plus` collided with the app's own chips (`kbd.cap.key`) -> `.fkey` / `.fplus`.
- The app's CSS transitions and looping animations were in the scoped copy -> dropped (they don't seek).
- The grabbed Account and Trash states kept the list behind the sheet -> left out when a sheet is open.
- The bridge's round cap showed as a dot on the PC before it was drawn -> hidden until it draws.
- Grey field labels copied from mail apps failed contrast -> #66666e (as in FolderBridge).
- "Sign in on each computer" sat on the PC's dark bezel and lost letters -> one line on the desk under both.
- The calculator covered the Invoices window's text -> the three windows side by side.
- The Trash row collapsed with margin tweens (snap to whole pixels) -> the next row moves up with a transform.
- The cursor covered the email as it was typed -> it waits at the field's right end.
- The icon + name lockup sat ~35 px left of centre (reveal and end card) -> centred.
- The end card opened on 0.2 s of blank ground -> the bridge draws from its first frame.
- The privacy scene's first half stayed under the second, the old-way overlay over the desk -> hidden while covered.

## Known and accepted
- `text_below_floor` and `contrast_aa_failure`: the real app UI at its real sizes and colours (the readable
  moments are close-ups at 1.4-1.6x) and the Mac menu bar on its wallpaper.
- `line_unread` on the language screens (they change on each spoken language name, as in the earlier films), the
  sign-up form and the notes window (only the address needs reading).
- `duplicate_media_discovery_risk`: the 128 px icon is used in several menu bars and windows.
- `font_face_local_only`: UI text is Segoe UI via `local()`, so renders are made on Windows. No font files in git.
- The first frame shows the PC monitor's right edge 9 px past the frame while the camera settles (as FolderBridge).

## The render (v1, 2026-11-09, after the user's OK)
- renders/keybridge-demo-v1.mp4: 1920x1080, 30 fps, 85.5 s, 26 MB, rendered in 4 m 34 s on this PC. Twelve frames
  pulled from the file match the preview.
- Sound (`hyperframes audio`): -17.1 LUFS, true peak -1.5 dBTP, no clipping. Quiet stretches: 0-0.56 s (before
  the voice), 36.96-37.85 s (the planned breath at the cut to sign-in), and 82.1 s to the end - the music's last
  chord has decayed, so the end card's last 3.4 s are near-silent after the Download click (FolderBridge's music
  ran to the end; listen for it).
- Web copy docs/media/keybridge-demo.mp4: two-pass loudnorm to -16.0 LUFS, true peak -1.4 dBFS after AAC, libx264
  crf 23 slow, fast start, AAC 160k 48 kHz, 11.6 MB. Stills: poster.jpg (29.6 s, Right Shift + E with the address
  landed), hero.jpg (44.22 s, both computers, same list, the bridge), 1600x900.

## Not checked
- The sound was measured (peaks placed one frame after their pictures, music levels as FolderBridge), not heard.

## Weakest shot
The privacy keyboard (63.5-66.4 s) is busy for 3 s: a field, a panel and 29 keys. With more time: drop the
bottom keyboard row, or show only the keys that are pressed.
