# Creature Arena: working notes

A browser battle game for the Genome Wrapped creatures. It is a separate project from
~/genome-mythology. The game never reads DNA. It uses only each creature's 4 gene types.

## Status (2026-10-19)

Day 1 is built and tested, but not yet signed off. The screen recording is not done.

- Art: all 16 creatures are present and named correctly. The originals are copied
  unchanged into `art/source/`. Shadepounce comes from genome-mythology, and its pixels
  match the copy in `~/Desktop/creature_art/Ember/`.
- Cut-outs are in `public/creatures/`. They were made with `art/tools/cutout.py` and
  `crop.py`, then run through `oxipng -o 4 --strip safe`. None of these steps is lossy.
  The cream became transparent, and the baked floor shadow became a soft dark shadow.
- Blazeleap is the only artwork that faces left (`FACES_LEFT` in `src/creatures.ts`).
- Genome Wrapped has no shareable creature code. Its story card has only the name,
  title and 3 myth lines. Day 3 therefore uses a picker of the 16.
- The game uses plain canvas and TypeScript, built with Vite. Every tunable number is
  in `src/config.ts`.
- Day 1 matchup: you play Shadepounce (WASD + F) against the computer as Morningdrift,
  its exact opposite. Other Day 1 features: countdown, slow-motion K.O., and a win
  screen with Rematch and Menu.
- Balance: the first version stun-locked. Whoever landed the first hit won with no hits
  coming back. That is fixed: a hit no longer cancels the victim's swing, knockback and
  stun are shorter, and the bot's reaction time is random (0.16 to 0.42 s).
  `BALANCE=1 npx vitest run --silent=false` reports about 55/45 for bot vs bot, with
  matches of about 13 s.

## Walk animations (2026-10-19)

The user's clips are in `~/Desktop/Walking videos`. They were copied unchanged into
`art/walk_source/`, and `Sparsnout.mp4` was renamed to `Sparksnout.mp4`.

- `art/tools/walk.py` makes each sheet. It takes one seamless walk cycle, removes the
  cream background from every frame, cancels sideways drift, clears the watermark corner
  (a sparkle, or the word "Veo"), and packs the frames into `public/walk/<Name>.png`.
  The sheet details go into `src/walks.json`.
- Five clips are in use: Emberjaw, Goldenhush, Moonwhisker, Sparksnout and Starmane.
- These clips are not used, because the clip crops the creature at the frame edge:
  - Duskfang: feet cut in 95% of frames, and its tail runs into the watermark corner.
  - Blazeleap, Dawnflare, Glowpaw, Morningdrift, Nightflicker and Sunsniffer: feet, ears
    or tails cut off.
  The fix is to re-generate these clips zoomed out, so the whole creature stays in frame.
- These have no clip yet: Shadepounce, Thunderjaw, Mooncoil and Sunburrow.
- Creatures without a usable clip keep their still image with the hop.
- The 5 sheets total 25 MB, and Moonwhisker alone is 9 MB. Before deploying (Day 4),
  consider lossless WebP, or ask the user whether lossy is OK.
- The title screen has a temporary dropdown to pick each side's creature, so the
  animations can be seen. The proper picker is Day 3 work.

## Days 2 to 4 (2026-10-19)

All four days are built. The game is not deployed, because the user said to wait.

- **Day 2: power ups.** Coffee, cilantro and energy orb each act by gene. Day and night
  switch every 20 to 30 s (the first switch comes after 10 to 16 s, and the starting
  time of day is random). The creature with the time advantage gets a sun or moon icon.
- **Day 2 addition: sprint.** Left Shift and Right Shift, plus a phone button. How it
  behaves comes from the ACTN3 muscle stat: Genome Wrapped trait `sprinter_vs_marathoner`,
  labelled "Sprinter vs marathoner", rs1815739. CC = power, TT = endurance, CT = mixed;
  the game offers only Sprinter and Endurance for now. It's chosen in the picker and is
  not one of the 4 creature axes. All sprint numbers are in `config.ts`.
- **Day 3:**
  - Picker for all 16 creatures. Genome Wrapped has no creature code, so there's no
    code entry. Clicks and keyboard both work, with each player's cursor using their
    own keys.
  - 2 player mode on one keyboard.
  - Gene-aware computer: it avoids power ups that hurt it, goes for ones that help,
    presses its time-of-day advantage and sprints.
  - Synthesised sound, with M to mute.
- **Day 4:**
  - Phone controls and the portrait camera.
  - Thumbnails for the menus.
  - Local network play: `npm run lan`, with `server/lan.mjs`, `src/net.ts` and an
    in-house QR encoder (`src/qr.ts`).
- **Balance:** computer vs computer across all creature pairs gives win rates of about
  37–67% per creature and average fights of about 16 s. Bold creatures beat Keen ones a
  bit, because cilantro heals Bold while Keen gets nothing good from it.

## Round 3 (2026-10-19)

- **Creature code:** see `docs/creature_code.md`. The same encoder is in
  genome-mythology on branch `creature-code`. The shared test vectors are
  `tests/code_vectors.json`. There's a code box on the picker and on the LAN join screen.
- **Mixed sprint type** (ACTN3 CT) added. A code with an unknown sprint type asks the
  player to choose.
- **Custom keys:** Controls screen, `src/input.ts`. Saved in localStorage as
  `arena-keys`, with clashes and Esc/M/Tab blocked.
- **Item icons:** coffee, cilantro and moon come from `~/Desktop/creature_art/items`
  (`art/tools/items.py`), listed in `src/items.json`. Not used:
  - `orb.webp`: a "dreamstime" watermarked stock preview;
  - `sun.webp`: a "Vecteezy" watermarked stock preview.
  The drawn orb and sun stay until licensed or self-made versions arrive.
- **Balance:** `docs/balance_before.md` and `docs/balance_after.md`. The main fix was
  `cilantro.heal` 8 → 2: computer-vs-computer fights are so close that any bigger heal
  makes Bold win 57–62%.
- **Web copy is lossless WebP.**
  - The working PNGs live in `art/png/`.
  - `public/` has only WebP, from `art/tools/to_webp.sh`, which checks every visible
    pixel.
  - When re-making art: write the PNG to `art/png/...`, then run
    `to_webp.sh public/<dir> art/png/<dir>/<file>.png`.
  - `dist` is 36 MB.

## Hatchling Expedition (branch `expedition`, 2026-10-19)

The co-op mode is built and playable with the core genes. Its code is in `src/coop/`:
- `rooms.ts`: the 6 room maps and their legends.
- `solver.ts`: the logical model, checked against all teams.
- `world.ts`: the real-time rules.
- `render.ts`: drawing.
- `ui.ts`: the lobby, flow, team genome panel and network play.

`src/sprites.ts` was split out of the arena renderer so both modes share creature art.
The LAN server now takes up to 3 guests and knows each room's mode.

Waiting on the user:
- **Approval of extra traits.** Proposed: bitter taste (TAS2R38), asparagus smell
  (OR2M7), motion sickness (NECTIN3), and optionally photic sneeze (weak evidence). Not
  proposed: sweet tooth. It's ancestry-hinting: one result is 99% in EAS and 34% in EUR.
- **ACTN3 flag.** The sprint trait, already in the creature code, is fairly
  ancestry-informative: CC is 77% in AFR and 16% in AMR/SAS. The user should decide
  whether to keep it.
- ~~**The cilantro SNP is not on the GSA**~~ Resolved (branch `bitter-axis`): Senses is now
  TAS2R38 rs713598 (G carrier = Keen) and Time is HCRTR2 rs2653349 (A carrier = Dawn), both on
  GSA v3, 23andMe v1 to v5 and AncestryDNA v2. Code format, creatures, names and art unchanged.
  The cilantro power up became bitter greens (drawn broccoli; same numbers: Bold heals, Keen
  reels), and the Did you know? facts use the new genes' worldwide shares (Dawn 22%, Keen 73%).
- **The ideas list** in the round report (team combos, new room types).

## Next session

- The user has `~/Desktop/to be animated/` (11 pictures plus a list of what makes a clip
  usable) for the walk clips still needed.
- When re-made walk clips arrive, check `~/Desktop/creature_art/runs/` (the user named
  this folder) and `~/Desktop/Walking videos`.
  - Process a clip with `art/tools/walk.py <clip> <Name> <start> <period> art/png/walk/<Name>.png ...`, then convert it with `to_webp.sh`. To find
    a seamless loop, see `scratchpad loop.py`, or copy the logic: the best seam between
    frames i and i+p.
  - Then rebuild `src/walks.json` from `art/walk_meta/`.
- Before deploying to Netlify, which is only on the user's go-ahead:
  - The user chose lossless WebP (done; `dist/` is 36 MB).
  - The Netlify build keeps `connect-src 'none'`. Only `server/lan.mjs` relaxes it, and
    only on the LAN.

## Opened from Genome Wrapped (2026-10-24)

- The reveal and story card in Genome Wrapped link here: `arena/index.html#code=ABC-DEF&play=battle`
  opens the picker with that creature as Player 1 (choose the computer's creature next);
  `&play=coop` opens the Hatchling Expedition lobby with Player 1 set (`Expedition.presetCode`).
  Only the creature code travels, in the fragment; the game still never reads DNA.
- The build is now one classic script plus one stylesheet (`vite.config.ts`: iife, no CSS split,
  the `classic-script` plugin), because browsers refuse ES module scripts on `file://` pages and
  the game is also opened from the built app on disk. No top-level `await` in `src/main.ts`.
- `app/scripts/bundle_games.ts` (run by the app's `npm run build`) copies `dist/` to `app/dist/arena/`.

### Multiplayer on a hosted static site (e.g. Netlify)

- Works as is: solo vs computer, 2 players on one keyboard (desktop), and Hatchling Expedition with
  2 to 4 players on one keyboard or one touch device. LAN buttons stay hidden (`lanAddresses()` is
  empty), so nothing is offered that can't work.
- Needs something more: play across devices. Today that is `npm run lan`, a Node WebSocket relay on a
  laptop on the same Wi-Fi; a static host can't run it.
- Peer to peer without a server seeing the game: WebRTC data channels. The two browsers still have to
  swap a connection offer and answer once. Options, no server built yet:
  1. Same Wi-Fi: swap them by QR code (host shows one, guest scans and shows one back). No server
     at all; local candidates are enough.
  2. Over the internet: the same QR or copy-paste swap plus a public STUN server, which only tells each
     browser its public address; it never sees game traffic. Works on most home networks.
  3. Strict networks (some mobile carriers, offices): a TURN relay is needed. It forwards the
     traffic but it's encrypted end to end (DTLS), so it can't read it; it is still a server
     someone runs (or a paid service).
  A small signalling server would make joining one tap instead of a QR swap; it would see only
  the offer/answer (addresses), never the game.
