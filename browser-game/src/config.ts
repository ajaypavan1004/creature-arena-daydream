// Every tunable number in the game lives here, so balance can be adjusted in one place.
// Distances are world units (the arena radius is 520), times are seconds, speeds are
// units per second, damage is health points (fighters start with fighter.maxHp).

export const CONFIG = {
  arena: {
    /** Radius of the walkable stone ring. */
    radius: 520,
    /** Vertical squash of the floor: 1 = straight down, smaller = flatter, more angled view. */
    tilt: 0.58,
    /** Height of the ring's stone side wall, drawn below the floor. */
    wallHeight: 46,
    /** Glowing edge: colour, and how fast it pulses (cycles per second). */
    edgeColor: "#7fe7ff",
    edgePulse: 0.35,
    /** On tall phone screens, zoom in this much (the camera follows the fight). */
    portraitZoom: 1.5,
  },

  fighter: {
    maxHp: 150,
    /** Body radius used for collisions between creatures and with the arena edge. */
    radius: 60,
    /** How tall a creature is drawn, in world units. */
    spriteHeight: 205,
    /** Top running speed. */
    maxSpeed: 290,
    /** How quickly a creature reaches its target speed (higher = snappier). */
    responsiveness: 12,
    /** Slow-down rate when there is no input or during hit stun. */
    friction: 7,
  },

  attack: {
    /** Basic attack damage. */
    damage: 5,
    /** Reach from body centre to body centre for a hit to land. */
    range: 155,
    /** Half-angle of the swing in radians: the target must be within this of the aim. */
    arc: 1.1,
    /** Time between attacks. */
    cooldown: 0.55,
    /** Delay from pressing attack to the hit landing. */
    windup: 0.09,
    /** Forward burst at the start of a swing. */
    lunge: 380,
    /** Push given to the creature that gets hit. */
    knockback: 210,
    /** Time the hit creature cannot act. */
    hitStun: 0.12,
    /** Aim at the opponent automatically when they are within range x this. */
    autoAim: 1.6,
  },

  bot: {
    /** Time the computer takes to react before swinging once in range (min, max). */
    reaction: [0.16, 0.42] as const,
    /** Distance at which the computer starts swinging. */
    attackRange: 138,
    /** Chance after each swing that it backs off or circles instead of pressing in. */
    backOffChance: 0.45,
    /** How long a back-off or circling move lasts (min, max). */
    backOffTime: [0.35, 0.8] as const,
    /** Fraction of the computer's top speed (1 = as fast as the player). */
    speed: 0.92,
    /** It goes for a helpful power up within this distance... */
    seekRange: 650,
    /** ...but mid-fight only if it's this close. */
    grabRange: 170,
    /** Extra room it keeps from power ups that would hurt it. */
    avoidMargin: 25,
  },

  motion: {
    /** Hops per second while moving, and hop height. */
    bobRate: 4.2,
    bobHeight: 9,
    /** Maximum lean (radians) when running and when lunging. */
    lean: 0.1,
    lungeLean: 0.24,
    /** How long a hit creature flashes white. */
    hitFlash: 0.16,
  },

  /**
   * Sprint (Left Shift / Right Shift). How it feels comes from the muscle stat, the
   * ACTN3 sprinter/endurance trait ("Sprinter vs marathoner" in Genome Wrapped):
   * CC = Sprinter, CT = Mixed, TT = Endurance.
   * Stamina runs from 1 (full) to 0; drain and refill are per second.
   */
  sprint: {
    Sprinter: { speed: 1.65, drain: 0.66, refill: 0.24 },
    /** ACTN3 CT, in between. */
    Mixed: { speed: 1.5, drain: 0.32, refill: 0.24 },
    Endurance: { speed: 1.3, drain: 0.16, refill: 0.24 },
    /** Stamina starts refilling this long after letting go. */
    refillDelay: 0.5,
    /** Run dry and you can't sprint again until stamina is back to this. */
    restartAt: 0.3,
  },

  powerUps: {
    /** Seconds between spawns (min, max), and the most that can be on the floor at once. */
    spawnEvery: [3.5, 6.5] as const,
    maxOnField: 3,
    /** First spawn this long after "Fight!". */
    firstSpawn: 2.5,
    /** A power up disappears after this long (it blinks for the last 2 seconds). */
    lifetime: 14,
    /** Pickup radius (added to the creature's body radius). */
    radius: 30,
    /** Spawns stay this far inside the ring, and this far from both creatures. */
    spawnArea: 0.75,
    spawnClearance: 150,
    /** Relative chance of each kind. */
    weights: { coffee: 1, greens: 0.22, orb: 1 },
  },

  /** Keen creatures' sharp senses (Senses gene). */
  keen: {
    /** They see a faint marker where a power up will appear, this many seconds early. */
    foresight: 1.0,
    /** They grab power ups from this much further away. */
    grabBonus: 40,
  },

  /** Coffee (Flame gene). */
  coffee: {
    /** Blaze: speed multiplier and how long it lasts. */
    boostSpeed: 1.55,
    boostTime: 5,
    /** Ember: frozen with the jitters for this long. */
    jitterTime: 1.5,
  },

  /** Bitter greens (Senses gene: TAS2R38 bitter taste). */
  greens: {
    /** Bold: health restored. Balanced against Keen's sharp senses (keen, below) and by
     *  bitter greens being rarer than the other power ups (powerUps.weights). */
    heal: 10,
    /** Keen (tastes bitterness): reels out of control for this long, at this speed. */
    recoilTime: 1.5,
    recoilSpeed: 340,
    /** How slowly the reel loses speed (lower = slipperier). */
    recoilFriction: 0.6,
  },

  /** Energy orb (Spark gene). */
  orb: {
    /** Crackling: the next attack is a lightning dash. */
    dashLunge: 2.4,
    dashDamage: 9,
    dashRange: 60,
    /** Still gets a shield that blocks the next hit completely. A held charge or
     *  shield runs out after this long if unused. */
    holdTime: 15,
  },

  /** Day and night (Time gene). */
  dayNight: {
    /** Seconds between switches (min, max). */
    every: [20, 30] as const,
    /** Length of the lighting change. */
    transition: 2.5,
    /** Damage multiplier for Dawn creatures in daytime and Dusk creatures at night. */
    advantage: 1.4,
    /** The first switch comes sooner (min, max), so both Dawn and Dusk get their turn. */
    first: [10, 16] as const,
    /** "day", "night", or "random" (a coin flip each match). */
    start: "random" as "day" | "night" | "random",
  },

  /** Hatchling Expedition (co-op). Distances in world units; a tile is coop.tile wide. */
  coop: {
    tile: 64,
    /** Explorer body radius, and how tall they're drawn. */
    radius: 21,
    spriteHeight: 96,
    walkSpeed: 230,
    responsiveness: 14,
    friction: 10,
    /** Blaze dash (Attack key): speed, how long it lasts, time between dashes. */
    dash: { speed: 950, time: 0.22, cooldown: 0.8 },
    /** Timed gate (Blaze) and timed run door (Sprinter, Mixed): seconds open after the switch. */
    gateWindow: 0.7,
    runWindow: 1.9,
    /** Keen nose: reveal hidden doors, traps and keys within this many tiles. */
    sniffRadius: 2.5,
    /** Still calm: soothe a wild critter within this many tiles, taking this long. */
    calmRadius: 2.2,
    calmTime: 1.2,
    /** Bold jaws: seconds of munching to clear a bramble wall. */
    munchTime: 1.0,
    /** Ember glow: seconds next to an ice wall to melt it; glow radius in tiles. */
    meltTime: 2.2,
    glowRadius: 3.2,
    /** Everyone else sees this far in the dark (tiles). */
    darkSight: 0.9,
    /** Heavy blocks: push speed; stamina used per second of pushing by muscle type; how
     *  fast an unfinished push slides back. A block moves 2 tiles to lock into its slot. */
    push: { speed: 46, drain: { Sprinter: 0.9, Mixed: 0.32, Endurance: 0.15 }, slideBack: 140 },
    /** A wild critter shoves anyone who isn't Still. */
    critterShove: 320,
    /** Day and night switch this often (seconds); stones flicker for the last `warn` seconds. */
    dayNight: 9,
    warn: 2,
    /** After a fall or a trap: seconds before the explorer is back at the start. */
    respawn: 1.0,
    /** Tutorial hints show when an explorer comes this close (tiles). */
    hintRadius: 3,
    /** Slingshot flight: seconds in the air, and how high the arc goes (world units). */
    slingshot: { flight: 0.75, arc: 90 },
  },

  match: {
    /** Countdown before the fight starts (3, 2, 1, Fight!). */
    countdown: 2.4,
    /** Slow-motion pause after the final hit before the win screen. */
    koPause: 1.3,
  },

  fx: {
    /** Screen shake strength on a hit, in screen pixels. */
    shake: 7,
    /** How long floating damage numbers last. */
    popupTime: 0.8,
  },
} as const;
