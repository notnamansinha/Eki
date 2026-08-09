"use client";

import { useState, useEffect, useId, useRef } from "react";
import { db } from "@/lib/firebaseFirestore";
import {
  collection,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { Send, X, MessageCircle } from "lucide-react";
import { auth } from "@/lib/firebaseAuth";
import { useDialogFocus } from "@/hooks/useDialogFocus";

const MAX_MESSAGE_LENGTH = 500;

interface Message {
  id: string;
  text: string;
  from: "driver" | "passenger";
  senderName: string;
  senderId: string;
  timestamp: Timestamp | null;
}

interface BaseProps {
  sessionId: string;
  currentUserRole: "driver" | "passenger" | "admin";
  currentUserId: string;
  currentUserName: string;
  onUnreadCountChange?: (count: number) => void;
}

type Props = BaseProps & (
  | { isOverlay: true; onClose: () => void }
  | { isOverlay?: false; onClose?: () => void }
);

export default function MessagingPanel({ 
  sessionId, 
  currentUserRole, 
  currentUserId, 
  currentUserName, 
  onClose,
  isOverlay = false,
  onUnreadCountChange,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenCountRef = useRef(0);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(isOverlay, () => onClose?.());

  useEffect(() => {
    lastSeenCountRef.current = 0;

    if (!sessionId) return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, "ride_sessions", sessionId, "messages"),
        orderBy("timestamp", "asc"),
        limitToLast(200),
      ),
      (snapshot) => {
          const msgs = snapshot.docs.map((message) => ({ id: message.id, ...message.data() })) as Message[];
          setMessages(msgs);

          // Count messages from others to surface unread badge
          if (onUnreadCountChange) {
            const othersCount = msgs.filter((m: Message) => m.senderId !== currentUserId).length;
            if (othersCount > lastSeenCountRef.current) {
              onUnreadCountChange(othersCount - lastSeenCountRef.current);
            }
            lastSeenCountRef.current = othersCount;
          }

          if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = setTimeout(() => {
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            messagesEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
          }, 100);
      }, (error) => {
        console.warn("[Chat] messages read failed:", error.message);
      }
    );

    return () => {
      unsubscribe();
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [sessionId, currentUserId, onUnreadCountChange]);

  // --- Rate Limiting Logic ---
  const [messagesSentCounts, setMessagesSentCounts] = useState<{timestamp: number}[]>([]);

  // --- Profanity filtering is enforced server-side on send; the client
  // keeps only the quick UX checks below. ---

  const showTransientMessage = (message: string) => {
    setRateLimitMsg(message);
    if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    rateLimitTimerRef.current = setTimeout(() => setRateLimitMsg(""), 3000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !newMessage.trim() || !sessionId) return;

    const authenticatedUserId = auth.currentUser?.uid;
    if (!authenticatedUserId || authenticatedUserId !== currentUserId) {
      showTransientMessage("Your session changed. Please reopen chat and try again.");
      return;
    }

    // Keep the client-side quick checks for snappy UX; the backend enforces
    // the authoritative 60/hr rolling limit, the 3s gap, and the profanity
    // filter when it persists the message.
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentMessages = messagesSentCounts.filter(m => m.timestamp > oneHourAgo);

    if (recentMessages.length >= 60) {
      showTransientMessage("Limit reached — 60 messages/hour");
      return;
    }

    if (recentMessages.length > 0 && (now - recentMessages[recentMessages.length - 1].timestamp < 3000)) {
      showTransientMessage("Please wait three seconds before sending again.");
      return;
    }

    const roleForMsg = currentUserRole === "admin" ? "driver" : currentUserRole;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) {
      showTransientMessage("Chat service is not configured.");
      return;
    }

    setSending(true);
    try {
      const response = await fetch(`${backendUrl}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await auth.currentUser?.getIdToken()) ?? ""}`,
        },
        body: JSON.stringify({
          text: newMessage.trim().slice(0, MAX_MESSAGE_LENGTH),
          from: roleForMsg,
          senderName: currentUserName.trim().slice(0, 100) || (roleForMsg === "driver" ? "Operator" : "Rider"),
        }),
      });
      const result = (await response.json()) as { error?: string; retryAfterMs?: number };
      if (!response.ok) {
        const error = new Error(result.error || "Unable to send message.") as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      setMessagesSentCounts([...recentMessages, { timestamp: now }]);
      setNewMessage("");
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status)
        : 0;
      if (code === 429 || (typeof error === "object" && error !== null && "message" in error && String((error as { message?: string }).message).includes("wait"))) {
        showTransientMessage("Please wait before sending another message.");
      } else {
        console.error("Failed to send message", error);
        showTransientMessage("Message could not be sent. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      tabIndex={isOverlay ? -1 : undefined}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay || undefined}
      aria-labelledby={isOverlay ? titleId : undefined}
      className={`flex flex-col h-full relative overflow-hidden ${isOverlay ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      style={{ 
        background: "var(--surface-1)", 
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.3)" 
      }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4" 
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div>
          <h3 id={titleId} className="font-semibold text-[15px] flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--status-live)" }} />
            Live Chat
          </h3>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--text-ghost)" }}>
            Session {sessionId.substring(0, 8)}
          </p>
        </div>
        {isOverlay && onClose && (
          <button 
            onClick={onClose}
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 gap-4 flex flex-col relative z-10 text-sm">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-fade-in">
            <MessageCircle className="w-8 h-8 mb-3" style={{ color: "var(--text-ghost)" }} />
            <p className="text-[12px] font-semibold text-center" style={{ color: "var(--text-ghost)" }}>
              No messages yet
            </p>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-ghost)" }}>
              Send a message to the {currentUserRole === "driver" ? "riders" : "driver"}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId || (currentUserRole === 'driver' && msg.from === 'driver');
            
            return (
              <div 
                key={msg.id} 
                className={`flex flex-col max-w-[80%] animate-slide-up ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
              >
                <div className={`flex items-baseline gap-1.5 mb-1 px-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[10px] font-semibold" 
                    style={{ color: isMe ? "var(--accent)" : "var(--text-ghost)" }}>
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  {msg.timestamp instanceof Timestamp && (
                    <span className="text-[9px] font-medium" style={{ color: "var(--text-ghost)" }}>
                      {msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div 
                  className="px-4 py-2.5 text-[14px] leading-relaxed"
                  style={{
                    borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: isMe ? "var(--accent)" : "var(--surface-3)",
                    color: isMe ? "#1a1a1a" : "var(--text-primary)",
                    fontWeight: isMe ? 500 : 400,
                  }}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Rate limit toast */}
      {rateLimitMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <div role="status" aria-live="polite" className="px-4 py-2 rounded-lg text-[11px] font-semibold"
            style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
            {rateLimitMsg}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 shrink-0 relative z-10"
        style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Chat message"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Message…"
            className="flex-1 h-11 rounded-xl px-4 text-[14px] font-medium focus:outline-none transition-all"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all"
            style={{ background: "var(--accent)", color: "var(--surface-0)" }}
            aria-label="Send message"
          >
            <Send className="w-5 h-5 ml-0.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
