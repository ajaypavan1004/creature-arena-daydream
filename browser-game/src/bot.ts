// The computer opponent. It chases and swings like a player, and it knows its own genes:
// it goes for power ups that help it and steers around the ones that would hurt it (an
// Ember bot avoids coffee, a Keen bot avoids bitter greens; a Keen bot also senses where the
// next power up will appear). It also presses its advantage at
// its time of day, punishes a jittery or reeling opponent, and uses a lightning dash from
// further away.
import { CONFIG } from "./config.ts";
import { grabReach, hasTimeAdvantage, helps, type Fighter, type Game, type Pickup } from "./sim.ts";

export class Bot {
  private ready = 0;
  private mode: "chase" | "circle" | "back" = "chase";
  private modeT = 0;
  private circleSign = 1;
  private lastCooldown = 0;
  private reaction: number = CONFIG.bot.reaction[1];
  /** Which way it walks round each harmful power up (by pickup id). */
  private avoidSide = new Map<number, number>();
  /** The power up it's heading for, if any. */
  target: Pickup | null = null;

  private rand: () => number;

  constructor(rand: () => number = Math.random) { this.rand = rand; }

  think(me: Fighter, foe: Fighter, dt: number, game?: Game): void {
    const B = CONFIG.bot;
    const dx = foe.x - me.x, dy = foe.y - me.y, d = Math.hypot(dx, dy) || 1;
    const tx = dx / d, ty = dy / d;
    const strong = game ? hasTimeAdvantage(game, me) : false;
    const weak = game ? hasTimeAdvantage(game, foe) && !strong : false;
    const foeHelpless = foe.jitter > 0 || foe.bitter > 0;

    // Right after a swing, maybe back off or circle for a moment (less often at its own
    // time of day, more often at the opponent's).
    const backOff = foeHelpless ? 0 : B.backOffChance * (strong ? 0.5 : weak ? 1.5 : 1);
    if (me.cooldown > this.lastCooldown && this.rand() < backOff) {
      this.mode = this.rand() < 0.5 ? "back" : "circle";
      this.modeT = B.backOffTime[0] + this.rand() * (B.backOffTime[1] - B.backOffTime[0]);
      this.circleSign = this.rand() < 0.5 ? 1 : -1;
    }
    this.lastCooldown = me.cooldown;
    this.modeT -= dt;
    if (this.modeT <= 0) this.mode = "chase";

    const reach = B.attackRange + (me.charged > 0 ? CONFIG.orb.dashRange : 0);
    let ix: number, iy: number;
    // Keen creatures sense the next power up before it appears and can head there early.
    const sensed = game ? (me.creature.senses === "Keen" && game.pending ? [...game.pickups, game.pending] : game.pickups) : [];
    this.target = game ? this.pickTarget(me, foe, sensed, d) : null;
    if (this.target && !foeHelpless) {
      const px = this.target.x - me.x, py = this.target.y - me.y, pd = Math.hypot(px, py) || 1;
      ix = px / pd; iy = py / pd;
    } else if (this.mode === "back" && !foeHelpless) { ix = -tx * 0.8 - ty * 0.4 * this.circleSign; iy = -ty * 0.8 + tx * 0.4 * this.circleSign; }
    else if (this.mode === "circle" && !foeHelpless) { ix = -ty * this.circleSign + tx * 0.25; iy = tx * this.circleSign + ty * 0.25; }
    else if (d > reach * 0.8) { ix = tx; iy = ty; }
    else { ix = tx * 0.2; iy = ty * 0.2; }

    // Steer around power ups that would hurt it.
    if (game) {
      for (const p of game.pickups) {
        if (helps(me.creature, p.kind)) continue;
        const ax = me.x - p.x, ay = me.y - p.y, ad = Math.hypot(ax, ay) || 1;
        const keepOff = grabReach(me) + B.avoidMargin;
        if (ad >= keepOff + 60) continue;
        const push = (keepOff + 60 - ad) / 60 * 2, rx = ax / ad, ry = ay / ad;
        // Heading into it: slide round the side (pushing straight back would stall it).
        if (ix * rx + iy * ry < 0) {
          // Pick a side once per power up and keep it, or it dithers left and right.
          let side = this.avoidSide.get(p.id);
          if (side === undefined) {
            const cross = ix * ry - iy * rx;
            side = Math.abs(cross) > 0.05 ? Math.sign(cross) : this.circleSign;
            this.avoidSide.set(p.id, side);
          }
          ix += -ry * side * push; iy += rx * side * push;
        }
        ix += rx * push * 0.6; iy += ry * push * 0.6;
      }
    }

    // Stay off the glowing edge.
    const r = Math.hypot(me.x, me.y), edge = CONFIG.arena.radius * 0.78;
    if (r > edge) { const push = (r - edge) / (CONFIG.arena.radius - edge); ix -= (me.x / r) * push * 1.5; iy -= (me.y / r) * push * 1.5; }
    me.intent = { x: ix, y: iy };

    // Sprint to reach a power up or close a big gap, and to get away when backing off.
    // A sprinter saves its stamina for short bursts; an endurance creature runs longer.
    const reserve = me.muscle === "Sprinter" ? 0.55 : me.muscle === "Mixed" ? 0.4 : 0.25;
    const far = this.target ? Math.hypot(this.target.x - me.x, this.target.y - me.y) > 180 : d > 300;
    me.sprintHeld = me.stamina > reserve && (far || (this.mode === "back" && weak)) || (me.sprinting && me.stamina > 0.05 && far);

    // Swing once the opponent has been in range for the reaction time. A shielded
    // opponent is still worth hitting: it pops the shield.
    if (d <= reach && foe.hp > 0) this.ready += dt * (foeHelpless ? 2 : 1); else this.ready = 0;
    if (this.ready >= this.reaction && me.cooldown <= 0 && me.stun <= 0) {
      me.attackPressed = true;
      this.ready = 0;
      this.reaction = B.reaction[0] + this.rand() * (B.reaction[1] - B.reaction[0]);
    }
  }

  /** The helpful power up worth going for now, or null to keep fighting. */
  private pickTarget(me: Fighter, foe: Fighter, pickups: Pickup[], foeDist: number): Pickup | null {
    const B = CONFIG.bot;
    let best: Pickup | null = null, bestScore = Infinity;
    for (const p of pickups) {
      if (!helps(me.creature, p.kind)) continue;
      // Already holding a charge or shield: another orb does nothing new.
      if (p.kind === "orb" && (me.charged > 0 || me.shield > 0)) continue;
      // Healing is only worth a detour when hurt.
      if (p.kind === "greens" && me.hp > CONFIG.fighter.maxHp - CONFIG.greens.heal * 0.5) continue;
      const pd = Math.hypot(p.x - me.x, p.y - me.y);
      const foeToIt = Math.hypot(p.x - foe.x, p.y - foe.y);
      let score = pd;
      if (p.kind === "greens") score *= me.hp < 50 ? 0.5 : 1;
      if (foeToIt < pd * 0.6 && helps(foe.creature, p.kind)) score *= 0.8; // get there first
      if (score < bestScore) { best = p; bestScore = score; }
    }
    // Don't wander off mid-exchange unless the power up is close.
    if (best && foeDist < B.attackRange * 1.2 && bestScore > B.grabRange) return null;
    return best && bestScore < B.seekRange ? best : null;
  }
}
