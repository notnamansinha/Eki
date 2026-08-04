"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebaseFirestore";
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { Send, X, MessageCircle } from "lucide-react";
import { auth } from "@/lib/firebaseAuth";

const MAX_MESSAGE_LENGTH = 500;

interface Message {
  id: string;
  text: string;
  from: "driver" | "passenger";
  senderName: string;
  senderId: string;
  timestamp: Timestamp | null;
}

interface Props {
  sessionId: string;
  currentUserRole: "driver" | "passenger" | "admin";
  currentUserId: string;
  currentUserName: string;
  onClose?: () => void;
  isOverlay?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

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
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  // --- Profanity Filter ---
  // Matches generic English, common Hindi/Hinglish profanities
  const PROFANITY_REGEX = /\b(fuck|shit|bitch|ass|asshole|cunt|dick|pussy|bastard|mc|bc|madarchod|bhenchod|chutiya|gandu|bhosadike|bhosdi|harami|kutta|bitch|slut|whore|randi|muth|bhosada)\b/gi;

  const censorText = (text: string) => {
    return text.replace(PROFANITY_REGEX, "***");
  };

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

    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentMessages = messagesSentCounts.filter(m => m.timestamp > oneHourAgo);
    
    if (recentMessages.length >= 60) {
      showTransientMessage("Limit reached — 60 messages/hour");
      return;
    }
    
    // Add 3-second quick spam cooldown
    if (recentMessages.length > 0 && (now - recentMessages[recentMessages.length - 1].timestamp < 3000)) {
      showTransientMessage("Please wait three seconds before sending again.");
      return;
    }

    const censoredContent = censorText(newMessage.trim()).slice(0, MAX_MESSAGE_LENGTH);
    const roleForMsg = currentUserRole === "admin" ? "driver" : currentUserRole;

    setSending(true);
    try {
      const messageRef = doc(collection(db, "ride_sessions", sessionId, "messages"));
      const rateRef = doc(db, "ride_sessions", sessionId, "messageRateLimits", currentUserId);
      await runTransaction(db, async (transaction) => {
        const rateSnapshot = await transaction.get(rateRef);
        const existing = rateSnapshot.data() as {
          sentAt?: Timestamp[];
          lastSentAt?: Timestamp;
          count?: number;
          windowStartedAt?: Timestamp;
        } | undefined;
        let sentAt: Timestamp[] = [];
        if (
          Array.isArray(existing?.sentAt) &&
          existing?.lastSentAt instanceof Timestamp
        ) {
          sentAt = [...existing.sentAt, existing.lastSentAt];
        } else if (
          existing?.windowStartedAt instanceof Timestamp &&
          existing?.lastSentAt instanceof Timestamp
        ) {
          const legacyCount = Math.max(1, Math.min(60, Number(existing.count) || 1));
          if (now - existing.windowStartedAt.toMillis() < 60 * 60 * 1000) {
            sentAt = [
              ...Array<Timestamp>(legacyCount - 1).fill(existing.windowStartedAt),
              existing.lastSentAt,
            ];
          }
        }
        if (sentAt.length >= 60) {
          if (now - sentAt[0].toMillis() < 60 * 60 * 1000) {
            const rateLimitError = new Error("Rolling message limit reached.") as Error & {
              code: string;
            };
            rateLimitError.code = "rate-limit";
            throw rateLimitError;
          }
          sentAt = sentAt.slice(1);
        }

        transaction.set(rateRef, {
          userId: currentUserId,
          sentAt,
          lastSentAt: serverTimestamp(),
        });
        transaction.set(messageRef, {
          text: censoredContent,
          from: roleForMsg,
          senderName: currentUserName.trim().slice(0, 100) || (roleForMsg === "driver" ? "Operator" : "Rider"),
          senderId: currentUserId,
          timestamp: serverTimestamp(),
        });
      });
      setMessagesSentCounts([...recentMessages, { timestamp: now }]);
      setNewMessage("");
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code.includes("permission-denied") || code === "rate-limit") {
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
    <div className={`flex flex-col h-full relative overflow-hidden ${isOverlay ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      style={{ 
        background: "var(--surface-1)", 
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.3)" 
      }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4" 
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div>
          <h3 className="font-semibold text-[15px] flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
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
          <div className="px-4 py-2 rounded-lg text-[11px] font-semibold"
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
