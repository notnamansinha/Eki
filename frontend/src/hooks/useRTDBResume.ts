"use client";

import { useCallback, useEffect, useReducer } from "react";
import { goOffline, goOnline, onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import { recordRealtimeConnection } from "@/lib/telemetryTrace";
import { invalidateLiveBusCache } from "@/lib/liveBusStore";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";
import {
  initialRTDBResumeLifecycle,
  reduceRTDBResumeLifecycle,
} from "./rtdbResumeState";

const MIN_SUSPENSION_MS = 30_000;
const RECONNECT_DEBOUNCE_MS = 500;
const RECONNECT_COOLDOWN_MS = 5_000;

export interface RTDBResumeState {
  isConnected: boolean;
  isResuming: boolean;
  resumeGeneration: number;
  connectionGeneration: number;
  markSnapshotReceived: () => void;
}

export function useRTDBResume(): RTDBResumeState {
  const [lifecycle, dispatch] = useReducer(
    reduceRTDBResumeLifecycle,
    initialRTDBResumeLifecycle,
  );
  useEffect(() => {
    let active = true;
    let connected = false;
    let disconnected = false;
    let hiddenSince = document.visibilityState === "hidden" ? performance.now() : null;
    let suspensionRefresh = false;
    let reconnectTimer: number | undefined;
    let cooldownTimer: number | undefined;
    let lastReconnectAt = Number.NEGATIVE_INFINITY;
    const available = () => document.visibilityState !== "hidden" && navigator.onLine;
    const cancelReconnect = () => {
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const markDisconnected = () => {
      connected = false;
      if (!disconnected) invalidateLiveBusCache();
      disconnected = true;
      dispatch({ type: "connection", connected: false });
    };
    const scheduleReconnect = (afterSuspension = false) => {
      suspensionRefresh ||= afterSuspension;
      if (!available() || (!suspensionRefresh && !disconnected)) return;
      if (performance.now() - lastReconnectAt < RECONNECT_COOLDOWN_MS) return;
      // Wait for a stable visible/online window. SDK reconnection may win this
      // race; a confirmed connection cancels a redundant manual handshake.
      cancelReconnect();
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!active || !available() || (!suspensionRefresh && !disconnected)) return;
        suspensionRefresh = false;
        lastReconnectAt = performance.now();
        connected = false;
        disconnected = true;
        dispatch({ type: "reconnect-requested" });
        invalidateLiveBusCache();
        goOffline(rtdb);
        goOnline(rtdb);
        if (cooldownTimer !== undefined) window.clearTimeout(cooldownTimer);
        cooldownTimer = window.setTimeout(() => {
          dispatch({ type: "reconnect-cooldown-ended" });
        }, RECONNECT_COOLDOWN_MS);
      }, RECONNECT_DEBOUNCE_MS + liveBusRetryDelayMs(0));
    };
    const connectedRef = ref(rtdb, ".info/connected");
    const unsubscribe = onValue(connectedRef, (snapshot) => {
      if (!active) return;
      const current = snapshot.val() === true;
      recordRealtimeConnection(current);
      if (current) {
        connected = true;
        disconnected = false;
        if (!suspensionRefresh) cancelReconnect();
        dispatch({ type: "connection", connected: true });
      } else if (connected) {
        markDisconnected();
        scheduleReconnect();
      } else {
        // Initial .info=false is connection restoration, not evidence that a
        // previously healthy socket needs to be forcibly restarted.
        dispatch({ type: "connection", connected: false });
      }
    });

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince ??= performance.now();
        cancelReconnect();
        return;
      }
      const elapsed = hiddenSince === null ? 0 : performance.now() - hiddenSince;
      hiddenSince = null;
      scheduleReconnect(elapsed >= MIN_SUSPENSION_MS);
    };
    const handleOffline = () => {
      cancelReconnect();
      markDisconnected();
    };
    const handleOnline = () => scheduleReconnect();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      unsubscribe();
      cancelReconnect();
      if (cooldownTimer !== undefined) window.clearTimeout(cooldownTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const markSnapshotReceived = useCallback(() => {
    dispatch({ type: "snapshot-received" });
  }, []);

  return {
    isConnected: lifecycle.connected,
    isResuming: !lifecycle.connected || lifecycle.awaitingSnapshot,
    resumeGeneration: lifecycle.resumeGeneration,
    connectionGeneration: lifecycle.connectionGeneration,
    markSnapshotReceived,
  };
}
