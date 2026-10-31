"use client";

import { useEffect } from "react";

const STALE_AFTER_MS = 15 * 60 * 1000;

/** A home-screen app has no reload button and no pull to refresh, and iOS keeps
 *  it frozen in the background: opened again on Sunday morning, it would still
 *  show Saturday's injuries. In a browser tab the reader can reload themselves,
 *  and a reload would cost them what they were doing. */
export default function ReloadWhenStale() {
  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    let hiddenAt: number | null = null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_MS) {
        window.location.reload();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  return null;
}
