// The powers sidebar: every creature in play, and what each of its genes does in this
// mode. Shown during fights and expeditions so players remember what's what. On small
// screens it folds away behind a "Powers" button.

export interface PowersEntry {
  /** "P1 · Shadepounce", "You · Glowpaw"... */
  label: string;
  color: string;
  /** One line per gene: [gene version, what it does]. */
  lines: Array<[string, string]>;
}

const STORE = "arena-powers-open";

export class PowersPanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private toggle: HTMLButtonElement;
  private open: boolean;
  private key = "";

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORE); } catch { /* storage blocked */ }
    // Open by default on wide screens, folded on phones.
    this.open = saved ? saved === "1" : innerWidth >= 900;
    this.root = document.createElement("aside");
    this.root.className = "powers";
    this.root.setAttribute("aria-label", "Creature powers");
    this.root.hidden = true;
    this.toggle = document.createElement("button");
    this.toggle.className = "powers-toggle";
    this.toggle.setAttribute("data-testid", "powers-toggle");
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    this.body = document.createElement("div");
    this.body.className = "powers-body";
    this.body.setAttribute("data-testid", "powers");
    this.root.append(this.toggle, this.body);
    document.body.append(this.root);
    this.setOpen(this.open);
  }

  private setOpen(on: boolean): void {
    this.open = on;
    this.body.hidden = !on;
    this.toggle.textContent = on ? "Hide powers" : "Powers";
    this.toggle.setAttribute("aria-expanded", String(on));
    try { localStorage.setItem(STORE, on ? "1" : "0"); } catch { /* storage blocked */ }
  }

  /** Show these creatures (or hide the panel with an empty list). */
  show(title: string, entries: PowersEntry[]): void {
    this.root.hidden = entries.length === 0;
    const key = JSON.stringify([title, entries]);
    if (key === this.key) return;
    this.key = key;
    const h = document.createElement("h3");
    h.textContent = title;
    const cards = entries.map((e) => {
      const card = document.createElement("section");
      card.className = "powers-card";
      card.style.setProperty("--who", e.color);
      const name = document.createElement("p");
      name.className = "powers-name";
      name.textContent = e.label;
      const ul = document.createElement("ul");
      for (const [gene, text] of e.lines) {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = gene;
        li.append(b, ` ${text}`);
        ul.append(li);
      }
      card.append(name, ul);
      return card;
    });
    this.body.replaceChildren(h, ...cards);
  }

  hide(): void { this.show("", []); }

  /** Screen width (CSS px) the open sidebar takes on the right; 0 when folded, hidden, or on phones. */
  reserved(): number {
    if (this.root.hidden || this.body.hidden || innerWidth <= 640) return 0;
    return this.root.offsetWidth + 20;
  }
}
