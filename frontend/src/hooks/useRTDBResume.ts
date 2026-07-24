"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { goOffline, goOnline, onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import {
  initialRTDBResumeLifecycle,
  reduceRTDBResumeLifecycle,
} from "./rtdbResumeState";

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
  const wasHiddenRef = useRef(
    typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const reconnectPendingRef = useRef(false);
  const reconnectCooldownRef = useRef<number | undefined>(undefined);

  const reconnect = useCallback(() => {
    if (reconnectPendingRef.current) return;
    reconnectPendingRef.current = true;
    dispatch({ type: "reconnect-requested" });
    goOffline(rtdb);
    goOnline(rtdb);
    reconnectCooldownRef.current = window.setTimeout(() => {
      reconnectPendingRef.current = false;
      dispatch({ type: "reconnect-cooldown-ended" });
    }, 250);
  }, []);

  useEffect(() => {
    const connectedRef = ref(rtdb, ".info/connected");
    const unsubscribe = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val() === true;
      dispatch({ type: "connection", connected });
    });

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
        return;
      }
      if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        reconnect();
      }
    };
    const handleOffline = () => {
      dispatch({ type: "connection", connected: false });
    };
    const handleOnline = () => reconnect();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      unsubscribe();
      if (reconnectCooldownRef.current !== undefined) {
        window.clearTimeout(reconnectCooldownRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [reconnect]);

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
