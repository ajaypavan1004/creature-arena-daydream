// Phone controls: a floating joystick on the left half of the screen (it appears where
// the thumb lands), and Attack and Sprint buttons on the right.
import type { Vec } from "./sim.ts";

/** Keep getting this finger's moves even if it slides off the element (best effort). */
function capture(el: Element, id: number): void {
  try { el.setPointerCapture(id); } catch { /* pointer already gone */ }
}

export const isTouchDevice = () => matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

export class TouchControls {
  private root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private origin: Vec = { x: 0, y: 0 };
  private dir: Vec = { x: 0, y: 0 };
  private attacks = 0;
  private sprintDown = false;
  private radius = 56;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "touch";
    this.root.hidden = true;
    this.base = document.createElement("div");
    this.base.className = "stick";
    this.knob = document.createElement("div");
    this.knob.className = "knob";
    this.base.append(this.knob);
    const pad = document.createElement("div");
    pad.className = "stick-zone";
    pad.append(this.base);
    const attack = document.createElement("button");
    attack.className = "tbtn attack";
    attack.textContent = "Attack";
    attack.setAttribute("data-testid", "touch-attack");
    const sprint = document.createElement("button");
    sprint.className = "tbtn sprint";
    sprint.textContent = "Sprint";
    this.root.append(pad, attack, sprint);
    document.body.append(this.root);

    pad.addEventListener("pointerdown", (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      capture(pad, e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add("on");
      this.move(e.clientX, e.clientY);
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY); });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.dir = { x: 0, y: 0 };
      this.knob.style.transform = "";
      this.base.classList.remove("on");
    };
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);

    attack.addEventListener("pointerdown", (e) => { e.preventDefault(); this.attacks++; attack.classList.add("on"); });
    attack.addEventListener("pointerup", () => attack.classList.remove("on"));
    attack.addEventListener("pointercancel", () => attack.classList.remove("on"));
    sprint.addEventListener("pointerdown", (e) => { e.preventDefault(); capture(sprint, e.pointerId); this.sprintDown = true; sprint.classList.add("on"); });
    const stop = () => { this.sprintDown = false; sprint.classList.remove("on"); };
    sprint.addEventListener("pointerup", stop);
    sprint.addEventListener("pointercancel", stop);
    // Stop long-press menus and double-tap zoom on the controls.
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private move(x: number, y: number): void {
    let dx = x - this.origin.x, dy = y - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) { dx *= this.radius / d; dy *= this.radius / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, then full speed from about two thirds of the way out.
    const k = d < 8 ? 0 : Math.min(1, d / (this.radius * 0.66));
    this.dir = d ? { x: (dx / Math.hypot(dx, dy)) * k, y: (dy / Math.hypot(dx, dy)) * k } : { x: 0, y: 0 };
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) { this.dir = { x: 0, y: 0 }; this.sprintDown = false; this.attacks = 0; }
  }

  direction(): Vec { return this.dir; }
  sprint(): boolean { return this.sprintDown; }
  /** True once per tap of Attack. */
  takeAttack(): boolean {
    if (!this.attacks) return false;
    this.attacks--;
    return true;
  }
}
