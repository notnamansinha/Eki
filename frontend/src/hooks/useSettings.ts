/**
 * useSettings — real-time Firestore settings/global hook.
 *
 * FREE TIER OPTIMISATION:
 * The Firestore snapshot is held at module scope (a singleton listener).
 * No matter how many components call useSettings() simultaneously
 * (passenger page + settings panel + any future consumer), exactly ONE
 * network connection is opened to Firestore.  The listener is torn down
 * when the last subscriber unmounts.
 */
import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { auth } from "@/lib/firebaseAuth";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { apiRequest } from "@/lib/apiClient";
import { useAuth } from "./useAuth";

export interface GlobalSettings {
  serviceStartTime: string;
  noBusesMessage: string;
  noBusesSubMessage: string;
  announcementText: string;
  announcementActive: boolean;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  serviceStartTime: "8:00 am",
  noBusesMessage: "No buses running",
  noBusesSubMessage: "Service starts at {time}",
  announcementText: "",
  announcementActive: false,
};

function readGlobalSettings(value: unknown): GlobalSettings {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
    [key, typeof data[key] === typeof fallback ? data[key] : fallback],
  )) as unknown as GlobalSettings;
}

// ── Singleton state ───────────────────────────────────────────────────────────
let _settings: GlobalSettings = DEFAULT_SETTINGS;
let _loading = true;
let _listenerCount = 0;
let _unsubscribe: (() => void) | null = null;
let _starting = false;
let _generation = 0;
let _scope: string | null = null;
let _scopeGeneration: number | null = null;
const _listeners = new Set<() => void>();

function notifyAll() {
  _listeners.forEach(fn => fn());
}

async function ensureListener() {
  if (_timeoutId) clearTimeout(_timeoutId);
  _timeoutId = undefined;
  if (!_scope || _scopeGeneration !== getAuthVerificationGeneration() || _unsubscribe || _starting || _listenerCount === 0) return;
  _starting = true;
  const generation = _generation;
  const authGeneration = getAuthVerificationGeneration();
  try {
    await waitForAuth();
    if (getAuthVerificationGeneration() !== authGeneration || !_scope || generation !== _generation || _listenerCount === 0 || _unsubscribe) return;
    _unsubscribe = onSnapshot(
      doc(db, "settings", "global"),
      (snap) => {
        if (generation !== _generation) return;
        _settings = snap.exists()
          ? readGlobalSettings(snap.data())
          : DEFAULT_SETTINGS;
        _loading = false;
        notifyAll();
      },
      (err: unknown) => {
        if (generation !== _generation) return;
        const error = err as { code?: unknown; message?: unknown };
        const code = typeof error.code === "string" ? error.code : "unknown";
        if (code !== "permission-denied") {
          console.warn("[Settings] Firestore read failed:", error.message);
        }
        _loading = false;
        _unsubscribe = null;
        notifyAll();
        if (_listenerCount > 0 && code !== "permission-denied") {
          if (_timeoutId) clearTimeout(_timeoutId);
          _timeoutId = setTimeout(() => void ensureListener(), 5000);
        }
      },
    );
  } finally {
    if (generation === _generation) _starting = false;
  }
}

let _timeoutId: NodeJS.Timeout | undefined;

/** Prevent a previous account's cached settings from surviving sign-out. */
export function clearSettingsCache(): void {
  _generation += 1;
  _starting = false;
  if (_timeoutId) clearTimeout(_timeoutId);
  _timeoutId = undefined;
  _unsubscribe?.();
  _unsubscribe = null;
  _settings = DEFAULT_SETTINGS;
  _loading = true;
  notifyAll();
  void ensureListener();
}

function releaseListener() {
  if (_listenerCount === 0) {
    _scope = null;
    _scopeGeneration = null;
    clearSettingsCache();
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSettings(): {
  settings: GlobalSettings;
  loading: boolean;
  saveSettings: (partial: Partial<GlobalSettings>) => Promise<void>;
} {
  const { user, loading: authLoading } = useAuth();
  const authGeneration = getAuthVerificationGeneration();
  const scope = user?.role && !authLoading ? `${user.uid}:${user.role}:${authGeneration}` : null;
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!scope) return;
    if (_scope !== scope) {
      clearSettingsCache();
      _scope = scope;
      _scopeGeneration = authGeneration;
    }
    _listenerCount++;
    void ensureListener();
    const trigger = () => forceRender(n => n + 1);
    _listeners.add(trigger);

    return () => {
      _listeners.delete(trigger);
      _listenerCount--;
      releaseListener();
    };
  }, [scope, authGeneration]);

  const saveSettings = async (partial: Partial<GlobalSettings>) => {
    if (!scope || user?.role !== "admin" || auth.currentUser?.uid !== user.uid) throw new Error("Admin authentication required.");
    // Server-authoritative save: the admin panel no longer writes settings
    // from the client; PATCH /api/v2/settings/global validates partial updates.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) throw new Error("Settings service is not configured.");
    await waitForAuth();
    if (getAuthVerificationGeneration() !== authGeneration || auth.currentUser?.uid !== user.uid) throw new Error("Authentication changed. Try again.");
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Authentication required.");
    if (getAuthVerificationGeneration() !== authGeneration || auth.currentUser?.uid !== user.uid) throw new Error("Authentication changed. Try again.");
    const result = await apiRequest<{ saved?: boolean }>("/api/v2/settings/global", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(partial),
      fallbackError: "Unable to save settings.",
    });
    if (result?.saved !== true) throw new Error("Settings acknowledgement is missing.");
  };

  return { settings: scope === _scope ? _settings : DEFAULT_SETTINGS, loading: scope ? scope !== _scope || _loading : authLoading, saveSettings };
}
