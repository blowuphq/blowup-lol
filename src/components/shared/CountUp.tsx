'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Landing stat counter (Phase 4.6): counts a number up from zero once on
 * mount. SSR always emits the FINAL value, so no-JS clients and hydration
 * see the true figure — the animation is progressive enhancement only.
 * Honors prefers-reduced-motion by never leaving the static value.
 * Deliberately dependency-free (~40 lines) to keep the landing page light.
 */
export function CountUp({
  value,
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString('en-US'));
  const [shown, setShown] = useState(value);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return; // stay on the server-rendered figure
    }
    const DURATION_MS = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setShown(Math.round(value * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return <span className="tabular-nums">{fmt(shown)}</span>;
}
