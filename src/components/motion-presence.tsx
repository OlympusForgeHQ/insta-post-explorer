"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

// Retain only the last visible tree for the short exit of non-modal panels.
// Radix dialogs use their own Presence so focus traps and portals stay native.
export function MotionPresence({ present, children }: { present: boolean; children: ReactNode }) {
  const [retained, setRetained] = useState(children);
  const [mounted, setMounted] = useState(present);
  const ref = useRef<HTMLDivElement>(null);
  if (present && retained !== children) setRetained(children);
  if (present && !mounted) setMounted(true);

  useEffect(() => {
    if (present || !mounted) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // A fallback also releases the tree when CSS is unavailable or animations
    // are interrupted. Read the token so CSS remains the timing source of truth.
    const duration = Number.parseFloat(getComputedStyle(ref.current!).getPropertyValue("--motion-exit")) || 180;
    const finish = () => setMounted(false);
    const timer = window.setTimeout(finish, reduced?.matches ? 0 : duration + 50);
    const onPreferenceChange = () => { if (reduced?.matches) finish(); };
    reduced?.addEventListener("change", onPreferenceChange);
    return () => { clearTimeout(timer); reduced?.removeEventListener("change", onPreferenceChange); };
  }, [present, mounted]);

  if (!present && !mounted) return null;
  return <div ref={ref} className="motion-presence" data-motion-state={present ? "open" : "closed"}
    inert={!present} aria-hidden={!present || undefined}
    onAnimationEnd={event => {
      if (!present && event.target === event.currentTarget.firstElementChild) setMounted(false);
    }}>
    {present ? children : retained}
  </div>;
}
