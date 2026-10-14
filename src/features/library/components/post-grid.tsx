"use client";

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import type { ViewMode } from "@/features/library/types";
import { cn } from "@/lib/utils";

// Keep one sorted DOM list. CSS columns would fill vertically and change the
// visual reading order; cyclic placement preserves left-to-right batches.
export function PostGrid({ children, view, count }: { children: ReactNode; view: ViewMode; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Animate result/order or view changes without remounting media or selection.
  const signature = Array.isArray(children) ? children.map(child => child?.key).join("|") : "";
  const previous = useRef(`${view}:${signature}`);
  useEffect(() => {
    const next = `${view}:${signature}`;
    if (previous.current === next) return;
    previous.current = next;
    const grid = ref.current;
    if (!grid?.animate || !window.matchMedia) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const animation = grid.animate([{ opacity: .55 }, { opacity: 1 }], {
      duration: Number.parseFloat(getComputedStyle(grid).getPropertyValue("--motion-content")) || 260,
      easing: getComputedStyle(grid).getPropertyValue("--motion-ease").trim() || "ease-out",
    });
    const stop = () => { if (reduced.matches) animation.cancel(); };
    reduced.addEventListener("change", stop);
    return () => { animation.cancel(); reduced.removeEventListener("change", stop); };
  }, [signature, view]);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || view !== "masonry" || typeof ResizeObserver === "undefined") return;
    const cards = Array.from(grid.children) as HTMLElement[];
    let frame = 0;
    const layout = () => {
      frame = 0;
      const style = getComputedStyle(grid);
      const tracks = style.gridTemplateColumns.split(" ").map(Number.parseFloat).filter(Number.isFinite);
      const columns = Math.max(1, tracks.length);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const width = tracks[0] ?? grid.clientWidth;
      const inset = style.justifyContent === "center" ? Math.max(0, (grid.clientWidth - width * columns - gap * (columns - 1)) / 2) : 0;
      if (width <= 0) return;
      // Batch width writes, then height reads, then positions. Images, text and
      // viewport changes are observed without per-card React state or listeners.
      cards.forEach(card => { card.style.width = `${width}px`; });
      const heights = cards.map(card => card.offsetHeight);
      const bottoms = Array<number>(columns).fill(0);
      cards.forEach((card, index) => {
        const column = index % columns;
        card.style.left = `${inset + column * (width + gap)}px`;
        card.style.top = `${bottoms[column]}px`;
        bottoms[column] += heights[index] + gap;
      });
      grid.style.height = `${Math.max(0, ...bottoms) - (cards.length ? gap : 0)}px`;
      grid.dataset.masonryReady = "true";
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    cards.forEach(card => observer.observe(card));
    layout();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      delete grid.dataset.masonryReady;
      grid.style.removeProperty("height");
      cards.forEach(card => {
        for (const property of ["width", "left", "top"]) card.style.removeProperty(property);
      });
    };
  }, [children, view]);

  return <div ref={ref} style={{ "--post-count": Math.max(1, count) } as CSSProperties} className={cn("posts-grid", view === "masonry" ? "posts-masonry" : "posts-regular", view === "masonry" && count <= 4 && "posts-masonry-sparse", view === "masonry" && count === 1 && "posts-masonry-single")}>
    {children}
  </div>;
}
