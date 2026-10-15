"use client";

import { PureComponent, createRef, type CSSProperties, type ReactNode } from "react";
import type { ViewMode } from "@/features/library/types";
import { cssDurationMs } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Props = { children: ReactNode; view: ViewMode; count: number; sidebarVisible?: boolean };
type Box = { x: number; y: number; width: number; height: number; mediaHeight: number };
type Snapshot = { height: number; x: number; y: number; cards: Map<HTMLElement, Box> };

// getSnapshotBeforeUpdate reads the visible geometry BEFORE React changes media
// ratios/classes. This also captures an interrupted animation's current frame.
export class PostGrid extends PureComponent<Props, Record<string, never>, Snapshot | null> {
  private root = createRef<HTMLDivElement>();
  private observer: ResizeObserver | null = null;
  private reduced: MediaQueryList | null = null;
  private animations: Animation[] = [];
  private generation = 0;
  private frame = 0;
  private forceLayout = false;
  private width = 0;
  private lastLayout: Snapshot | null = null;
  private pendingMedia: Snapshot | null = null;
  private heights = new Map<HTMLElement, number>();

  componentDidMount() {
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reduced?.addEventListener("change", this.onMotionPreference);
    if (typeof ResizeObserver !== "undefined") this.observer = new ResizeObserver(() => this.schedule());
    this.layout(null);
  }

  getSnapshotBeforeUpdate() { return this.capture(); }
  componentDidUpdate(_previous: Props, _state: Record<string, never>, snapshot: Snapshot | null) { this.layout(snapshot); }
  componentWillUnmount() {
    this.observer?.disconnect();
    this.reduced?.removeEventListener("change", this.onMotionPreference);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.forceLayout = false;
    this.pendingMedia = null;
    this.cancelAnimations();
  }

  private onMotionPreference = () => { if (this.reduced?.matches) this.layout(null); };
  private onMediaLoad = () => {
    // Capture phase runs before PostCard updates its image aspect ratio.
    this.pendingMedia ??= this.capture();
    this.schedule(true);
  };
  private schedule = (force = false) => {
    this.forceLayout ||= force;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const grid = this.root.current;
      if (!grid) return;
      const widthChanged = Math.abs(grid.clientWidth - this.width) > .5;
      const forced = this.forceLayout;
      this.forceLayout = false;
      // Our height animations also emit ResizeObserver notifications. Only
      // intrinsic updates or a real width change should retarget them.
      if (!forced && !widthChanged && (this.animations.length || [...this.heights].every(([card, height]) => card.offsetHeight === height))) return;
      const before = this.pendingMedia ?? (this.animations.length ? this.capture() : this.lastLayout);
      this.pendingMedia = null;
      this.layout(before);
    });
  };

  private capture(): Snapshot | null {
    const grid = this.root.current;
    if (!grid) return null;
    const origin = grid.getBoundingClientRect();
    return { height: origin.height, x: origin.left + scrollX, y: origin.top + scrollY, cards: new Map(Array.from(grid.children, element => {
      const card = element as HTMLElement, rect = card.getBoundingClientRect();
      return [card, { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width,
        height: rect.height, mediaHeight: card.querySelector(".post-media")?.getBoundingClientRect().height ?? 0 }];
    })) };
  }

  private cancelAnimations() {
    this.generation++;
    this.animations.forEach(animation => animation.cancel());
    this.animations = [];
  }

  private layout(before: Snapshot | null) {
    const grid = this.root.current;
    if (!grid) return;
    this.observer?.disconnect();
    this.pendingMedia = null;
    // Keep the visible height throughout endpoint measurement. Exposing the
    // smaller target even for one layout read clamps scrollY near page bottom.
    grid.style.height = `${before?.height ?? grid.getBoundingClientRect().height}px`;
    this.cancelAnimations();
    const cards = Array.from(grid.children) as HTMLElement[];
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(" ").map(Number.parseFloat).filter(Number.isFinite);
    const columns = Math.max(1, tracks.length), gap = Number.parseFloat(style.columnGap) || 0;
    const width = tracks[0] ?? grid.clientWidth;
    const inset = style.justifyContent === "center" ? Math.max(0, (grid.clientWidth - width * columns - gap * (columns - 1)) / 2) : 0;
    // Batch writes and reads. Both layouts share absolute cards after hydration;
    // CSS grid remains a usable fallback before JavaScript is available.
    cards.forEach(card => { card.style.width = `${width}px`; card.style.removeProperty("height"); });
    grid.dataset.layoutReady = "true";
    if (this.props.view === "masonry") grid.dataset.masonryReady = "true";
    else delete grid.dataset.masonryReady;
    const naturalHeights = cards.map(card => card.offsetHeight);
    const bottoms = Array<number>(columns).fill(0);
    let rowTop = 0;
    cards.forEach((card, index) => {
      const column = index % columns;
      const regular = this.props.view === "grid";
      const rowStart = index - column;
      const height = regular ? Math.max(...naturalHeights.slice(rowStart, rowStart + columns)) : naturalHeights[index];
      const top = regular ? rowTop : bottoms[column];
      card.style.left = `${inset + column * (width + gap)}px`;
      card.style.top = `${top}px`;
      if (regular) card.style.height = `${height}px`;
      bottoms[column] = top + height + gap;
      if (column === columns - 1) rowTop += height + gap;
    });
    const targetHeight = Math.max(0, ...bottoms) - (cards.length ? gap : 0);
    this.width = grid.clientWidth;
    this.heights = new Map(cards.flatMap(card => {
      const content = card.querySelector<HTMLElement>(".post-card-button");
      return content ? [[card, card.offsetHeight] as const, [content, content.offsetHeight] as const] : [[card, card.offsetHeight] as const];
    }));
    const after = this.capture()!;
    after.height = targetHeight;
    this.lastLayout = after;
    const origin = grid.getBoundingClientRect();
    const animate = Boolean(typeof grid.animate === "function" && this.reduced && !this.reduced.matches);
    const duration = cssDurationMs(style.getPropertyValue("--motion-layout"), 520);
    const easing = style.getPropertyValue("--motion-arrive").trim() || "ease-out";
    const play = (element: HTMLElement, frames: Keyframe[], time = duration) => {
      const animation = element.animate(frames, { duration: time, easing });
      this.animations.push(animation);
    };
    if (animate) {
      for (const [card, next] of after.cards) {
        const previous = before?.cards.get(card);
        const old = previous && before ? { ...previous, x: previous.x + before.x - after.x, y: previous.y + before.y - after.y } : undefined;
        const nearby = (box: Box) => origin.top + box.y < innerHeight + 100 && origin.top + box.y + box.height > -100;
        if (!nearby(next) && (!old || !nearby(old))) continue;
        if (!old) {
          play(card, [{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], 360);
          continue;
        }
        if (Math.max(Math.abs(old.x - next.x), Math.abs(old.y - next.y), Math.abs(old.width - next.width), Math.abs(old.height - next.height), Math.abs(old.mediaHeight - next.mediaHeight)) < .5) continue;
        // Resize the real box and crop rather than scaling text or replacing the
        // media node. Only position uses a compositor translation.
        play(card, [
          { translate: `${old.x - next.x}px ${old.y - next.y}px`, width: `${old.width}px`, height: `${old.height}px` },
          { translate: "0 0", width: `${next.width}px`, height: `${next.height}px` },
        ]);
        const media = card.querySelector<HTMLElement>(".post-media");
        if (media) play(media, [{ height: `${old.mediaHeight}px` }, { height: `${next.mediaHeight}px` }]);
      }
      if (before && Math.abs(before.height - after.height) > .5) play(grid, [{ height: `${before.height}px` }, { height: `${after.height}px` }]);
    }
    grid.style.height = `${targetHeight}px`;
    this.observer?.observe(grid);
    cards.forEach(card => {
      this.observer?.observe(card);
      const content = card.querySelector(".post-card-button");
      if (content) this.observer?.observe(content);
    });
    if (this.animations.length) {
      const generation = this.generation;
      void Promise.allSettled(this.animations.map(animation => animation.finished)).then(() => {
        if (generation !== this.generation) return;
        this.animations = [];
        this.schedule();
      });
    }
  }

  render() {
    const { children, view, count } = this.props;
    return <div ref={this.root} onLoadCapture={this.onMediaLoad} style={{ "--post-count": Math.max(1, count) } as CSSProperties}
      className={cn("posts-grid", view === "masonry" ? "posts-masonry" : "posts-regular", view === "masonry" && count <= 4 && "posts-masonry-sparse", view === "masonry" && count === 1 && "posts-masonry-single")}>
      {children}
    </div>;
  }
}
