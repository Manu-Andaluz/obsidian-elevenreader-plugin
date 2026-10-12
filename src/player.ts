import { setIcon } from "obsidian";
import { clampPosition, formatClock } from "./player-geometry";

export type PlayerPhase = "idle" | "generating" | "playing" | "paused";

export interface PlayerHost {
  onPlay(): void;
  onPause(): void;
  onSeek(seconds: number): void;
  onPlace(left: number, top: number): void;
}

export class MiniPlayer {
  readonly root: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly seek: HTMLInputElement;
  private readonly time: HTMLElement;
  private phase: PlayerPhase = "idle";
  private seeking = false;
  private placed = false;

  constructor(private readonly host: PlayerHost) {
    this.root = document.createElement("div");
    this.root.addClass("elevenlabs-player");
    this.root.addClass("is-hidden");
    this.root.setAttr("role", "group");
    this.root.setAttr("aria-label", "Narration");

    this.playButton = document.createElement("button");
    this.playButton.type = "button";
    this.playButton.addClass("elevenlabs-player-play");
    this.playButton.addEventListener("click", () => {
      if (this.phase === "playing" || this.phase === "generating") this.host.onPause();
      else this.host.onPlay();
    });

    this.seek = document.createElement("input");
    this.seek.type = "range";
    this.seek.min = "0";
    this.seek.max = "0";
    this.seek.step = "0.1";
    this.seek.value = "0";
    this.seek.addClass("elevenlabs-player-seek");
    this.seek.setAttr("aria-label", "Seek");
    this.seek.addEventListener("input", () => {
      this.seeking = true;
      const seconds = Number(this.seek.value);
      this.time.setText(formatClock(seconds));
      this.host.onSeek(seconds);
    });
    this.seek.addEventListener("change", () => {
      this.seeking = false;
    });

    this.time = document.createElement("span");
    this.time.addClass("elevenlabs-player-time");
    this.time.setText("0:00");

    this.root.append(this.playButton, this.seek, this.time);
    document.body.append(this.root);
    this.render();
    this.root.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("resize", this.onResize);
  }

  show(): void {
    this.root.removeClass("is-hidden");
    this.reclamp();
  }

  setPhase(phase: PlayerPhase): void {
    this.phase = phase;
    this.render();
  }

  setProgress(current: number, duration: number): void {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.seek.max = String(safeDuration);
    this.seek.disabled = safeDuration === 0 || this.phase === "generating";
    if (!this.seeking) {
      const safeCurrent = Number.isFinite(current) ? current : 0;
      this.seek.value = String(Math.min(safeCurrent, safeDuration || safeCurrent));
      this.time.setText(this.phase === "generating" ? "…" : formatClock(safeCurrent));
    }
  }

  place(left: number, top: number): void {
    this.placed = true;
    this.root.addClass("is-placed");
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.reclamp();
  }

  destroy(): void {
    this.root.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }

  private render(): void {
    const active = this.phase === "playing" || this.phase === "generating";
    setIcon(this.playButton, active ? "pause" : "play");
    this.playButton.setAttr("aria-label", active ? "Pause" : "Play");
    if (this.phase === "generating") {
      this.seek.disabled = true;
      this.time.setText("…");
    }
  }

  private reclamp = (): void => {
    if (!this.placed || this.root.hasClass("is-hidden")) return;
    const rect = this.root.getBoundingClientRect();
    const next = clampPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
    this.root.style.left = `${next.left}px`;
    this.root.style.top = `${next.top}px`;
  };

  private onResize = (): void => {
    this.reclamp();
  };

  private onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, input")) return;

    const rect = this.root.getBoundingClientRect();
    const originLeft = rect.left;
    const originTop = rect.top;
    const pointerId = event.pointerId;
    this.root.setPointerCapture(pointerId);
    this.root.addClass("is-dragging");

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      const next = clampPosition(
        originLeft + ev.clientX - event.clientX,
        originTop + ev.clientY - event.clientY,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      );
      this.placed = true;
      this.root.addClass("is-placed");
      this.root.style.left = `${next.left}px`;
      this.root.style.top = `${next.top}px`;
    };

    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      this.root.removeEventListener("pointermove", move);
      this.root.removeEventListener("pointerup", up);
      this.root.removeClass("is-dragging");
      const placed = this.root.getBoundingClientRect();
      this.host.onPlace(placed.left, placed.top);
    };

    this.root.addEventListener("pointermove", move);
    this.root.addEventListener("pointerup", up);
  };
}
