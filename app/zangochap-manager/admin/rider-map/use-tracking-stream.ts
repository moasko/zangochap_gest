"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useTrackingStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setConnected(false);
    if (!enabled || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let lastMessage = 0;
    const invalidate = () => {
      if (refresh) return;
      refresh = setTimeout(() => { refresh = undefined; void queryClient.invalidateQueries({ queryKey: ["rider-tracking-live"] }); }, 200);
    };
    const close = () => { source?.close(); source = null; setConnected(false); };
    const open = () => {
      close();
      if (document.visibilityState !== "visible") return;
      lastMessage = Date.now();
      source = new EventSource("/api/admin/rider-tracking/stream");
      const alive = () => { lastMessage = Date.now(); setConnected(true); };
      source.addEventListener("ready", () => { alive(); invalidate(); });
      source.addEventListener("heartbeat", alive);
      source.addEventListener("change", () => { alive(); invalidate(); });
      source.onerror = () => setConnected(false);
    };
    open();
    document.addEventListener("visibilitychange", open);
    const watchdog = setInterval(() => {
      if (source && Date.now() - lastMessage > 35000) open();
    }, 5000);
    return () => { close(); clearTimeout(refresh); clearInterval(watchdog); document.removeEventListener("visibilitychange", open); };
  }, [enabled, queryClient]);
  return connected;
}
