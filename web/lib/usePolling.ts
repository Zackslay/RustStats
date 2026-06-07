"use client";

import { useEffect } from "react";

export function usePolling(task: () => void | Promise<void>, intervalMs: number, immediate = true) {
  useEffect(() => {
    let stopped = false;
    let running = false;

    const run = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await task();
      } finally {
        running = false;
      }
    };

    const first = immediate ? window.setTimeout(run, 0) : undefined;
    const interval = intervalMs > 0 ? window.setInterval(run, intervalMs) : undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (first !== undefined) window.clearTimeout(first);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [task, intervalMs, immediate]);
}
