# Creature Arena on the Daydream table

Creature Arena's fight, moved to Daydream (Adrian Cipriani's projector and camera table,
built on Folk). Two players stand at the short ends of the table. Their creatures, the
browser game's own paintings and walk cycles, fight on its stone arena in the middle, and
everything is played with hands. It is a Daydream app
(`dream new game` layout) for the SDK at UrsprungLabs/daydream-sdk. The browser game it
comes from is in Genome Wrapped (`games/creature-arena`).


![Pick screen](preview/pick.png)
![A fight](preview/fight.png)

## How to play

**Pick your creature.** Your end of the table shows five coloured switches, one per gene:
Flame, Time, Senses, Spark and Muscles. Pinch a switch, or hold a fingertip on it, to flip
it. Your creature and its genes show beside the switches. When you're happy, hold your
open palm on the ring that says "Palm here". The fight counts down once both players are
ready.

**Fight.**
- Each player has a ring at the bottom long edge, on their side (player 1 on the left).
  Your hand on your ring is a joystick: push it the way your creature should run, further
  for faster.
- Your other hand acts, anywhere on your side. Pinch to bite; the bite aims at the other
  creature when it's close.
- Make a fist with it to sprint. How long you can sprint depends on your muscle type.
- Rings of your colour show which hand does what. With one hand, the ring's hand steers and acts.
- Which hand is whose comes from the SDK's controls kit (`kits/controls`): by where each arm
  comes from, so other people's hands don't drive your creature.
- `steer follow` in ARENA_SETTINGS brings back the old way: your creature runs towards your
  hand (the one of yours nearest it), and your other hand acts.
- Your health and stamina bars run along your end of the table.

**Alone?** With the computer on (`botAfter 3` in ARENA_SETTINGS; it is off by default),
get ready, and if no hands come from the other end for 3 seconds, the computer plays it (the browser game's bot: it knows its genes, goes for the power ups that help it,
steers round the ones that hurt it, presses its time of day). Put a hand at that end on the
pick screen to take it back.

The first creature to empty the other's health wins. After the win the table goes back to
the pick screen, keeping both players' choices.

**What the genes do** (the same as the browser game):

| Power up | One version | The other version |
|---|---|---|
| Coffee (Flame) | Blaze: a speed boost for 5 s | Ember: frozen with the jitters for 1.5 s |
| Bitter greens (Senses) | Bold: heals 10 | Keen: reels out of control for 1.5 s |
| Energy orb (Spark) | Crackling: the next bite is a lightning dash | Still: a shield that blocks the next hit |

- **Keen** creatures sense a power up a second before it appears (a faint marker), and
  reach further to grab one.
- **Day and night** take turns. Dawn creatures bite 40% harder by day, Dusk creatures at
  night. A sun or a moon beside the ring shows which it is.

The game never sees DNA: a creature is only its name and four genes, as in the browser
game.

## What it's made of

- `creaturearena.folk`: the whole game. The rules are the browser game's (`src/sim.ts`)
  with the same numbers (`src/config.ts`), written in C for speed. The pictures (floor,
  creatures, shadows, power ups, sun and moon) are one draw a frame through its own GPU
  pipeline, `ca-sprite`: textured quads from two textures, with the browser game's hit
  flash and night shading in the shader. The glowing ring, slashes, sparks, shields and
  switches are light (the games kit's `games-dot` and `games-beam`). Until the textures
  are on the GPU the creatures are drawn as light, as before.
- `art/`: `atlas-0.png` .. `atlas-3.png` (the 16 paintings, the 5 walk cycles at 12 frames a
  second, the power ups, sun, moon and a shadow, on pages of about 17 MB each on the GPU),
  `floor.png` (the stone arena by day and by night, seen from above) and `atlas.h` (which
  page each picture is on, and where). All are RGB with the alpha as a grey lower half,
  because Folk's PNG loader drops a PNG's alpha channel; the `ca-sprite` pipeline reads
  both halves. The table copies them to the GPU a page at a time, 0.15 s apart, so the
  start of a game is a few short stalls, not one long one. Made from the browser-game branch:

  ```
  git worktree add ../browser origin/browser-game
  node tools/bake.mjs /tmp/baked              # the canvas-drawn art, with Playwright
  python3 tools/atlas.py ../browser/browser-game /tmp/baked art
  ```
- `tools/preview.folk` and `tools/render-preview.py`: the previews above, off the table
  (what the game wishes drawn, drawn as the GPU would).
- `app.tcl`: the app's manifest.
- `test/test-creaturearena.folk`: a headless test. It checks that a fingertip flips a gene,
  both palms start the fight, a hand leads its creature, a pinch bites, each power up does
  what the genes say, and the last bite wins.
- `test/scene.tcl`: the scene `dream budget` measures, the busiest moment of a fight.

## Checked

With the SDK's own tools, on Folk built from the SDK:

- `dream check`: no errors or warnings.
- `dream test`: passes.
- `dream budget` against the reference table, with the pictures: 1.35 ms CPU a frame
  (budget 2), 0.06 of a core (budget 0.25), about 1.3 ms GPU a frame (budget 2, an
  estimate), first light in about 10 ms.
- The previews above: `tools/preview.folk` on the made-up rig, drawn by
  `tools/render-preview.py`.

Not yet checked: playing it on the real table with real hands. Tracking noise, the
cameras' delay and real light can only be checked there (`dream zap`).

## Running it

From a checkout of daydream-sdk:

```
export PATH=$PWD/sdk/bin:$PATH
cd path/to/creature-arena-daydream
dream check
dream test
dream studio      # the emulated table in your browser: Games, then Creature Arena
dream zap         # only to send it to a real table
```

## Known limits

- The pictures stand upright for people at the table's bottom long edge, where players
  stand (`picturesFromEnds 1` in the settings turns each upright for its player at the
  short ends instead). The switches, bars and labels are still at the short ends.
- The browser game's floating words (BOOST, BITTER!), particles, banners and screen shake
  are not on the table yet; its light effects are RJ's.
- Two players only, at the short ends. No computer opponent.
- No creature code entry yet: genes are picked with the switches.
