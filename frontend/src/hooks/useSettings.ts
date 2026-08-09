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
import { waitForAuth } from "@/lib/authState";

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

// ── Singleton state ───────────────────────────────────────────────────────────
let _settings: GlobalSettings = DEFAULT_SETTINGS;
let _loading = true;
let _listenerCount = 0;
let _unsubscribe: (() => void) | null = null;
let _starting = false;
let _generation = 0;
const _listeners = new Set<() => void>();

function notifyAll() {
  _listeners.forEach(fn => fn());
}

async function ensureListener() {
  if (_timeoutId) clearTimeout(_timeoutId);
  _timeoutId = undefined;
  if (_unsubscribe || _starting || _listenerCount === 0) return;
  _starting = true;
  const generation = _generation;
  try {
    await waitForAuth();
    if (generation !== _generation || _listenerCount === 0 || _unsubscribe) return;
    _unsubscribe = onSnapshot(
      doc(db, "settings", "global"),
      (snap) => {
        _settings = snap.exists()
          ? { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<GlobalSettings>) }
          : DEFAULT_SETTINGS;
        _loading = false;
        notifyAll();
      },
      (err: unknown) => {
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
  if (_listenerCount === 0 && _unsubscribe) {
    _timeoutId = setTimeout(() => {
      if (_listenerCount === 0 && _unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
      }
    }, 3000);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSettings(): {
  settings: GlobalSettings;
  loading: boolean;
  saveSettings: (partial: Partial<GlobalSettings>) => Promise<void>;
} {
  const [, forceRender] = useState(0);

  useEffect(() => {
    _listenerCount++;
    void ensureListener();
    const trigger = () => forceRender(n => n + 1);
    _listeners.add(trigger);

    return () => {
      _listeners.delete(trigger);
      _listenerCount--;
      releaseListener();
    };
  }, []);

  const saveSettings = async (partial: Partial<GlobalSettings>) => {
    // Server-authoritative save: the admin panel no longer writes settings
    // from the client; PUT /api/settings validates and persists them.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) throw new Error("Settings service is not configured.");
    await waitForAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Authentication required.");
    const response = await fetch(`${backendUrl}/api/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(partial),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      throw new Error(result.error || "Unable to save settings.");
    }
  };

  return { settings: _settings, loading: _loading, saveSettings };
}
