import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { rideChatMessagesQuery } from "@/lib/rideChatMessages";
import { recordRealtimeWatch } from "@/lib/telemetryTrace";

interface UnreadState {
  /** The reader and session counted; empty while nothing is watched. */
  scope: string;
  /** Whether the chat is showing this session to the reader. */
  open: boolean;
  /**
   * Messages from others that the reader has had on screen, or that were
   * already there when the listener first synced. Null until that sync.
   * IDs, not a count: at the 200-message window a new message evicts an old one.
   */
  read: ReadonlySet<string> | null;
  /** Messages from others in the latest snapshot. */
  latest: readonly string[];
}

const scopeOf = (sessionId: string, userId: string) =>
  sessionId && userId ? JSON.stringify([userId, sessionId]) : "";

const unwatched = (scope: string, open: boolean): UnreadState =>
  ({ scope, open, read: null, latest: [] });

function withOpen(state: UnreadState, open: boolean): UnreadState {
  // Opening the chat shows every message already there.
  if (!open || state.read === null) return { ...state, open };
  return { ...state, open, read: new Set([...state.read, ...state.latest]) };
}

function withSnapshot(state: UnreadState, latest: readonly string[], fromCache: boolean): UnreadState {
  if (state.read === null) {
    // History from before the listener synced is not unread. A cached
    // snapshot can be partial, so only a server snapshot sets that baseline.
    return { ...state, latest, read: fromCache ? null : new Set(latest) };
  }
  return { ...state, latest, read: state.open ? new Set([...state.read, ...latest]) : state.read };
}

/**
 * The number of ride chat messages from others that arrived while the chat
 * was closed and have not been on screen since. Messages that arrive while
 * the chat is open are read, and opening the chat reads everything in it.
 *
 * The listener stays attached while `sessionId` is set, open or closed, and
 * uses the chat panel's own query, so the open panel shares its watch target.
 * Pass only a session the reader may read (a passenger's joined ride);
 * an empty `sessionId` or `userId` detaches it and clears the count.
 */
export function useRideChatUnread(sessionId: string, userId: string, chatOpen: boolean): number {
  const scope = scopeOf(sessionId, userId);
  const [state, setState] = useState(() => unwatched(scope, chatOpen));
  if (state.scope !== scope || state.open !== chatOpen) {
    // Adjusted while rendering, not in an effect, so another session or reader
    // never shows the previous count, even for one frame.
    setState(previous => previous.scope === scope ? withOpen(previous, chatOpen) : unwatched(scope, chatOpen));
  }

  useEffect(() => {
    const watched = scopeOf(sessionId, userId);
    if (!watched) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const authGeneration = getAuthVerificationGeneration();
    const current = () => active && authGeneration === getAuthVerificationGeneration();
    // Attach only after the first auth state resolves, as the chat panel does:
    // a claims-less cached token can get a permission-denied that onSnapshot
    // never retries (see #47 F1).
    void waitForAuth().then(() => {
      if (!current()) return;
      unsubscribe = onSnapshot(rideChatMessagesQuery(sessionId), (snapshot) => {
        if (!current()) return;
        const latest = snapshot.docs
          .filter(message => message.data().senderId !== userId)
          .map(message => message.id);
        setState(previous => previous.scope === watched
          ? withSnapshot(previous, latest, snapshot.metadata.fromCache)
          : previous);
      }, (error) => {
        if (current()) console.warn("[Chat] unread listener failed:", error.message);
      });
      recordRealtimeWatch("messages", true);
    });
    return () => {
      active = false;
      if (unsubscribe) recordRealtimeWatch("messages", false);
      unsubscribe?.();
    };
  }, [sessionId, userId]);

  if (state.open || state.read === null) return 0;
  const read = state.read;
  return state.latest.filter(id => !read.has(id)).length;
}
