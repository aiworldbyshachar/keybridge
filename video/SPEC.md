# KeyBridge - film spec

GOAL:    The viewer feels how tiring it is to type the same email address again and again, then the relief of
         one key that types it - with left and right as different keys - on every computer they sign in to; and
         knows it's free, that signing in is optional, and that only they can read their shortcuts.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    85.5 s x 30 = 2565 frames (payoff ends and the end card starts at 76.1). Narration (ElevenLabs, George, video/narration.json, 193 words, 80.5 s) starts
         at 0.5 s and is the clock: every beat starts on its anchor word. Word times = timings.json + 0.5 s, except
         a word that starts inside a measured pause, which moves to the pause's end (32 words, 0.05-0.85 s later;
         timings.json puts them at the pause's start). The times below are already corrected. Music (ElevenLabs
         Music, assets/audio/music.mp3) 85.7 s.
STORY:   Storyline A (STORYLINES.md): `dana.levi@example.com`, typed letter by letter twenty times a day.

LOOK:    The family's two worlds, same palette, same objects as the ClipBridge and FolderBridge films.
         - The desk: wall #F3EFE8, desk top #E4D8C7, 2% grain, daylight from upper left; contact shadows
           0 18px 40px rgba(60,40,20,.18). The "old way" (S2) drops to 70% saturation, 92% brightness.
         - The product: KeyBridge's light theme quoted from src/renderer/style.css (assets/ui.css copies it):
           ground #f5f5f8, surface #fff, border #e3e3eb, ink #191923, muted #676778, accent #5550d8,
           ok #16925a. Product shots at 1.6-1.8x.
         - Accent #5550d8 rationed: the bridge stroke, the "Right" label on a keycap, the one key element per
           shot, the end card button.
         - UI face Segoe UI (local) 400/600/700, as the app renders on Windows; mono for the code box as in the
           app. Wordmark Segoe UI 700, -2% tracking. Quiet labels 30-36 px Segoe UI 600.
OBJECTS: - MacBook Air (left) and 27" PC monitor (right): exactly the earlier films' (copied from
           D:\projects\foldersync\video).
         - The object: the address `dana.levi@example.com`. It's typed, mistyped, copied, and finally lands in one
           go. Same made-up person as the website pictures (Dana Levi, example.com). A Link shortcut opens its
           link (it doesn't type it), so the reply gets the address and the signature, not the link.
         - Other apps, generic and unbranded: on the PC a browser with a sign-up form ("Create your account",
           Name, Email); on the Mac a mail reply window (To, Subject, body); a plain notes window "things I
           paste"; a team calendar page; the Invoices folder. No real logos, browsers or mail apps.
         - The keycaps: white #FDFDFE, 5 px bottom edge #D3D4DA, 18 px radius, 54 px glyphs. A modifier keycap
           carries a small side label above its name, as the app's chips do: "Right" in accent, "Left" in muted.
         - The bridge: the 12 px accent arc from the Mac's screen to the PC's, round caps; it carries a keycap.
         - macOS cursor 64 px. The KeyBridge window: always the real renderer. tools/grab-ui.cjs renders
           src/renderer with the preview's made-up data (dev/mock-api.js) in each state and saves the markup to
           assets/ui/; tools/scope-ui.mjs makes assets/kb.css from src/renderer/style.css (scoped to .kb, light,
           no animations or transitions); tools/inject-ui.mjs puts each state into the scenes between
           <!-- ui:NAME --> markers. `npm run ui` does all three after the app changes.
         - Text that changes over time is a data-text attribute drawn by CSS ([data-text]::after), changed by
           explicit before/after tweens (swap() in each scene): set textContent doesn't undo on a backward seek.
MOTION:  Arrivals expo.out 0.4-0.6 s; camera power2.inOut 0.8-1.2 s; exits power3.in 0.25 s; the keycap rides
         the bridge power2.inOut 0.75 s. Key presses: the cap sinks 6 px with its edge shrinking to 1 px for
         4 frames. Clicks instant with a 4-frame press (scale 0.95). List stagger 70 ms. Typed letters 55 ms
         each when a person types; a shortcut's text lands in one frame (that contrast is the film's point).
         Titles land and hold still.
SHOTS:   (film seconds, on the anchor words; as built)
  S1  0.0-11.3  desk.html. Settle 1.14->1.1 on the pair. "Mac" 2.70 the Mac wakes: a mail reply to noa@example.com.
                "PC" 3.94 the PC wakes: the browser sign-up form. "email" camera to the PC from 4.6; the Email field
                is typed letter by letter from 5.55 (21 letters, key ticks). "twenty times" 6.63 a dark chip "20 times
                a day" under the monitor. "Letter" camera to the Mac from 7.95: the reply's last line "You can reach
                me at" gets the address again, slowly (0.1 s a letter).
  S2  11.3-21.4 detours.html, an overlay over the desk, desaturated (the sigh at 11.3): "note" the window "things I
                paste.txt", the cursor selects the address; "copy" Ctrl + C press. "Type" 15.05 typed again into a
                To field; "wrong" 16.81 it reads `dana.levi@exmaple.com`, red wavy underline. "new computer" 18.1 a new
                laptop rises, its screen lights on an empty Email field; "start all over" the caret blinks.
  S3  21.4-28.0 desk.html, full colour. "key" 22.18 a Right Shift keycap drops onto the desk between the computers
                (pop); "type it" 23.45 it presses; 24.45 it hops to the Mac's end of the bridge; "every computer" 24.86
                the bridge draws and the keycap rides it; "This" 26.5 the apex blooms into the icon, "KeyBridge" 27.06
                the name wipes in (riser peaks one frame after).
  S4  28.0-37.5 core.html. The PC's sign-up page close up. "Right" keycaps Right Shift + E; "E" 29.2 press; 29.27 the
                whole address lands in Email at once (pop). "Left" Left Shift + E; "E?" 32.05 press, "About you" gets a
                single E; "capital" 33.55 an accent ring draws round it. "Left and right" 35.0 cut to the real KeyBridge
                window at 1.6x (grabbed from src/renderer); "different" 35.95 the Email row's Right Shift + E light up.
  S5  37.5-46.5 signin.html. The Mac (wallpaper + menu bar with the KeyBridge icon), the real Account sheet at 1.55x:
                "sign in" the email is typed, Send link (click); the code step: the XXXX-XXXX-XXXX box fills K7QM-4XRT-
                P9WE, hyphens by themselves; Continue (click) 41.08. "Every shortcut" 41.16 the Mac's list fills
                (stagger); Right Cmd + 1 and Right Option + C light up. "only rule" 42.9 the window settles into the
                Mac on the desk, the PC has the same list, the bridge draws; "sign" 44.24 "Sign in on each computer" on
                the desk under both.
  S6  46.5-56.2 depth.html. The Mac reply: `;sig` typed, Space (48.32), the three signature lines land at once (48.4).
                The PC: Right Alt + C press, the team calendar opens 50.12; "folder" 50.8 the Invoices folder; "program"
                51.61 the calculator. "nothing" 53.35 the real Trash at 1.6x; the cursor to "Home address" (Older
                version); Restore (click) 54.4; the row leaves; "lost" 55.16 the app's toast "Restored".
  S7  56.2-66.4 privacy.html. The Mac on the desk with the Email shortcut as a card; "locked" 57.36 a lock closes on
                it; "code" 58.02 "Your code ●●●●-●●●●-●●●●"; "before" a sealed copy rises, its text scrambling
                (v1.k9Qx...), and rides to a plain cloud; "nobody else" it rests on the cloud. "And KeyBridge" 63.55 a
                text field and a keyboard: "Reach me at " typed key by key; Right Shift + E 65.35-65.45, the address
                lands, and the "What KeyBridge hears" panel shows only "Email - pressed" (65.52).
  S8  66.4-71.0 languages.html. The real window at 1.4x, switching language on each spoken name (English 66.4,
                Hebrew 67.31 right to left with Hebrew names, Spanish 68.27, French 68.74, Russian 69.63, Arabic 70.34
                right to left), each language's own name large on the left.
  S9  71.0-76.1 payoff.html. The Mac reply at normal speed: "Hi Noa, Sure! Reach me at" typed; Right Shift + E
                72.38, the address lands; `;sig` + Space 73.62, the signature lands; the cursor to Send; "once" 75.8
                Send (click), the window flies off.
  S10 76.1-85.5 endcard.html on #f5f5f8. The bridge draws at once; "KeyBridge" 77.31 it folds into the icon, the
                name wipes in; "Press it once. It's typed."; "open" "Free & open source", "Mac" 79.86, "Windows" 80.26;
                CTA "Download free" + github.com/aiworldbyshachar/keybridge from 80.9, held to the end.
SOUND:   Clicks only on real clicks, soft key ticks on typing (none when a shortcut's text lands - silence plus
         one pop), a whoosh on each detour change and on the bridge ride, pops on arrivals, one riser into the
         reveal (peak one frame after 27.06). SFX reused from the earlier films (assets/sfx, from FolderBridge).
         The music starts at 1.5 s (data-start="1.5"): its lift then lands on "type it for you", its pause on
         the cut to S5 and its last chord under the end card. Level as in FolderBridge: 0.15 under the voice,
         0.22 around the reveal (26.4-30), 0.16 after, 0.36 on the end card from 81.6, out over the last
         second. renders/keybridge-audio-preview.mp3 is this mix (voice + music only).
MUSIC:   Generated 2026-11-09, 85.7 s, with: "Instrumental underscore for a heartfelt product film, no vocals, sits
         under a voiceover. 0-21s: sparse and slightly weary, soft felt piano with a gentle ticking pulse like slow
         typing, lots of space. Around 21-26s a small hopeful lift and a soft swell. From 27s: warm, uplifting
         light indie-electronic groove at 100 BPM, soft plucked synths, warm pads, brushed percussion, steady and
         optimistic, never busy. Builds gently, brightest and fullest around 70-78s, then resolves into a calm,
         warm final chord by 85s." Measured (music's own time): quiet start, lift 18-24 s, a dip at ~27 s,
         silent 36.1-37.4 s, full from ~39 s, brightest ~72 s, silent from 81.9 s. In the film (+1.5 s): lift
         19.5-25.5, the silence 37.6-38.9 (in the mix only 37.0-37.8 has neither voice nor music), last chord
         decays by 83.4. The user listens before it's kept.
BANNED:  dark void grounds; glow, bloom, particles; purple/blue gradient grounds (the gradient lives only inside
         the icon); glass cards; three feature cards in a row; titles that drift after landing; everything
         fading and sliding up; the logo docked in a corner; invented KeyBridge UI (every KeyBridge screen
         copies src/renderer); named competitor brands, Clavier+ included; real browser, mail or cloud logos;
         real personal data (only the made-up Dana); long dashes in any on-screen text; "seamless",
         "effortless", "unlock".
QA:      frame 0 (desk, both computers); 6.5 (the address half typed on the PC); 13.5 (the note being copied);
         17.2 (`exmaple` underlined); 19.9 (the empty new laptop); 25.5 (the keycap on the bridge); 27.4 (icon +
         wordmark); 30.2 (the address landed at once); 33.8 (the single E circled); 36.3 (the editor's Right
         Shift + E lit); 40.0 (code box with template, typed); 42.0 (the list filled on the Mac, Right Cmd); 45.5
         ("Sign in on each computer"); 48.8 (signature landed); 51.0 (calendar + folder open); 55.4 ("Restored");
         62.0 (sealed card at the cloud); 65.8 ("Email - pressed"); 67.6 (Hebrew RTL); 70.6 (Arabic RTL); 74.0
         (the full reply); 82.0 (end card with URL).
CHAPTERS: 0:00 The problem, 0:11 The usual workarounds, 0:21 One key, 0:28 Left and right, 0:37 On your Mac too,
         0:46 Signatures, links and the trash, 0:56 Only you can read them, 1:06 Six languages, 1:11 Press it
         once, 1:16 Download.
