"use client";

import { useEffect } from "react";

export function usePolling(task: () => void | Promise<void>, intervalMs: number, immediate = true) {
  useEffect(() => {
    let stopped = false;

    const run = async () => {
      if (stopped) return;
      await task();
    };

    const first = immediate ? window.setTimeout(run, 0) : undefined;
    const interval = intervalMs > 0 ? window.setInterval(run, intervalMs) : undefined;

    return () => {
      stopped = true;
      if (first !== undefined) window.clearTimeout(first);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [task, intervalMs, immediate]);
}
