"use client";

import { useCallback, useMemo, useState } from "react";
import type { RiderMessageAlert } from "@/components/RiderMessageAlertOverlay";

export function useRiderAlertQueue() {
  const [queue, setQueue] = useState<RiderMessageAlert[]>([]);
  const activeAlert = queue[0] || null;
  const pendingCount = Math.max(0, queue.length - 1);

  const enqueueAlert = useCallback((alert: RiderMessageAlert) => {
    setQueue((current) => (
      current.some((item) => item.id === alert.id)
        ? current
        : [...current, alert]
    ));
  }, []);

  const closeActiveAlert = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  return useMemo(() => ({
    activeAlert,
    pendingCount,
    enqueueAlert,
    closeActiveAlert,
  }), [activeAlert, pendingCount, enqueueAlert, closeActiveAlert]);
}
