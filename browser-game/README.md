# Creature Arena

A browser battle game for the 16 Genome Wrapped creatures. Each creature's 4 gene types
decide what the power ups do to it. The game never reads DNA. There is no backend, no
accounts and no tracking, and the web version makes no network calls.

## Play on this laptop

```
npm run dev
```

Open the link it prints. The first screen has two choices:

- **Fight:** one on one in the arena. The Fight menu has Player vs Computer, 2 Players on
  one keyboard, local network play, Join a game, and Controls.
  - Player 1: W A S D to move, F to attack, Left Shift to sprint.
  - Player 2: the arrow keys, Enter and Right Shift.
  - M mutes. Esc goes back to the Fight menu.
- **Co-op:** Hatchling Expedition (below), for 2 to 4 players.
- **On phones:** Player vs Computer, with a thumb joystick and Attack and Sprint
  buttons. To play co-op, join a game hosted on a laptop.

During a fight or an expedition, a **powers sidebar** on the right lists every creature
in play and what each of its genes does. **Hide powers** folds it away; on phones it's
folded by default. In co-op, each creature's name is shown above it.

## Hatchling Expedition (co-op, 2 to 4 players)

Choose **Hatchling Expedition** on the title screen. Players work together through 6 rooms
instead of fighting. Every obstacle has two ways through, one for each version of a gene:

| Gene | One version | The other version |
|---|---|---|
| Flame | Blaze dashes (Attack key) through closing gates | Ember melts ice and lights dark burrows |
| Time | Dawn walks on sun stones by day | Dusk walks on moon stones at night |
| Senses | Keen sniffs out hidden doors, traps and buried keys | Bold munches through bramble |
| Spark | Crackling powers machines | Still calms wild critters and crosses fragile bridges |
| Muscles | Sprinter (and Mixed) win timed runs | Endurance (and Mixed) push heavy blocks |

**Players:**
- On one keyboard: up to 2 players, using each player's keys.
- On other devices: choose **Invite players on the network** (needs `npm run lan`). Up to
  4 explorers in all, on phones or laptops.

**Teamwork:**
- One creature holds a plate while the others go through.
- Levers on the far side open the way for everyone.
- The last room needs every player on a plate at once.

**After each room:** a team genome panel shows what each gene unlocked, and what a gene
the team didn't have would have opened. Bonus gems reward teams with a wider mix of genes.

**Team combos** (bonus gems only, never needed to finish):
- **Twilight bridge** (room 4): a Dawn creature on the sun pedestal and a Dusk creature on
  the moon pedestal at the same time.
- **Slingshot** (room 5): an Endurance creature holds the spring while a Blaze on the
  launcher presses Attack.

**Before and after rooms:**
- Before room 1, each player's **5-gene badge** shows what their genes do and how common
  each version is worldwide.
- After each room, **"Did you know?"** gives worldwide frequencies only (1000 Genomes,
  2,504 people), never broken down by population.
- **Save team genome card** downloads a picture of the team: creatures, their 4 creature
  genes, rooms done and gems. It never includes the sprint type.

**Lives:** there are no lives. A creature that falls is back at the start a second later.
Esc pauses, with Retry room.

**Checks:**
- `tests/coop_solver.test.ts` checks every room against every possible team of 2, 3
  and 4.
- `tests/coop_world.test.ts` checks that the timings work with the real speeds: only a
  Blaze dash beats a closing gate, Endurance can't win a timed run, a Sprinter can't push
  a block home.
- All numbers are in the `coop` section of `src/config.ts`.

## Creature code

Genome Wrapped shows a 6-character creature code (like `X43-4NA`) on the creature reveal
and the story card. Type it into the **Creature code** box on the picker, or into the
join screen for local network play. It loads your creature and your sprint type. If
your file didn't include the sprint gene, the game asks you to choose. You can always
pick a creature by hand instead. The format is in `docs/creature_code.md`.

## Controls

**Controls** on the title screen lets each player change their keys for move, attack
and sprint. Keys can't clash: a key used by the other player, Esc or M is refused. The
choices are saved in this browser, and **Reset to defaults** puts them back.

## Local network play (no internet needed)

On the host laptop, run this one line:

```
npm run lan
```

Then:

1. Connect the host laptop and the other device to the same WiFi, or connect both to the
   host's phone hotspot. Internet access isn't needed.
2. On the host laptop, open **http://localhost:8787/** and choose **Host on local network**.
   A QR code and a 4-letter room code appear.
3. On the other phone or laptop, scan the QR code with the camera. Or open the address
   shown under the QR code (for example `http://192.168.1.23:8787/`), tap **Join a game**,
   and type the room code.
4. Each player chooses a creature and muscle type. The host presses **Fight!**
5. Controls: the host plays with W A S D, F and Left Shift. The other player uses their
   own keyboard (either key set), or the joystick and buttons on a phone.

The first time, macOS may ask whether Node can accept incoming connections. Choose
**Allow**, or other devices can't connect. Press Ctrl+C to stop the server.

How it works: `server/lan.mjs` is a small Node server with no extra packages. It serves
the game and passes messages between the two devices. The host's browser runs the game.
The other device sends its controls and draws what the host sends back. Nothing leaves
the local network.

## Tuning

Every number (speeds, damage, durations, spawn rates, sprint, the computer's skill) is in
`src/config.ts`.

To check balance (computer vs computer, every creature and sprint type), run:

```
BALANCE=1 npx vitest run --silent=false
```

`BALANCE_REPEATS=3` plays more games per pairing. `BALANCE_SET="greens.heal=4"` tries
a setting without editing the config. The latest tables are in `docs/balance_before.md`
and `docs/balance_after.md`.

## Tests

- `npm test` runs the rules, power ups, day and night, sprint, computer opponent,
  creature code and custom keys tests.
- `node tests/qr.browser.mjs` checks the QR codes using Chrome's built-in reader.
- `node tests/lan.browser.mjs` is a full local network game, from joining through to the
  win screen. Build first.
- `node tests/coop.browser.mjs` plays through all 6 expedition rooms.
- `node tests/coop_lan.browser.mjs` runs a 4-explorer network expedition with a phone guest.
- `npm run test:browser` builds the game and runs all four of these.

## Art

- `art/source/` holds the original 16 images, unchanged.
- `art/png/` holds the working PNGs:
  - `creatures/`: cut-outs made with `art/tools/cutout.py` and `crop.py`;
  - `thumbs/`: small menu previews (`thumbs.py`);
  - `walk/`: walk-cycle sprite sheets from the animated clips (`walk.py`);
  - `items/`: power-up icons (`items.py`).
- `public/` holds what the game loads: the same images as lossless WebP, made with
  `art/tools/to_webp.sh`. Every visible pixel is checked to be identical.
