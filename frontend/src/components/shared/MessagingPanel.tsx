"use client";

import { useState, useEffect, useRef } from "react";
import { rtdb, auth } from "@/lib/firebase";
import { ref, push, onValue, serverTimestamp } from "firebase/database";
import { waitForAuth } from "@/lib/authState";
import { Send, X, MessageCircle } from "lucide-react";

interface Message {
  id: string;
  text: string;
  from: "driver" | "passenger";
  senderName: string;
  senderId: string;
  timestamp: number;
}

interface Props {
  busId: string;
  currentUserRole: "driver" | "passenger" | "admin";
  currentUserId: string;
  currentUserName: string;
  onClose?: () => void;
  isOverlay?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

export default function MessagingPanel({ 
  busId, 
  currentUserRole, 
  currentUserId, 
  currentUserName, 
  onClose,
  isOverlay = false,
  onUnreadCountChange,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [rateLimitMsg, setRateLimitMsg] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenCountRef = useRef(0);

  useEffect(() => {
    if (!busId) return;

    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    waitForAuth().then(() => {
      if (!isMounted) return;
      const messagesRef = ref(rtdb, `messages/${busId}`);
      unsubscribe = onValue(messagesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const msgs = Object.entries(data).map(([id, val]) => ({
            id,
            ...(val as Record<string, unknown>) // Type assertion to satisfy spread, since val is unknown/Partial
          }) as Message).sort((a: Message, b: Message) => (a.timestamp || 0) - (b.timestamp || 0));
          setMessages(msgs);

          // Count messages from others to surface unread badge
          if (onUnreadCountChange) {
            const othersCount = msgs.filter((m: Message) => m.senderId !== currentUserId).length;
            if (othersCount > lastSeenCountRef.current) {
              onUnreadCountChange(othersCount - lastSeenCountRef.current);
            }
            lastSeenCountRef.current = othersCount;
          }

          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        } else {
          setMessages([]);
        }
      }, (error) => {
        console.warn("[RTDB] messages read failed:", error.message);
      });
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [busId, currentUserId, onUnreadCountChange]);

  // --- Rate Limiting Logic ---
  const [messagesSentCounts, setMessagesSentCounts] = useState<{timestamp: number}[]>([]);

  // --- Profanity Filter ---
  // Matches generic English, common Hindi/Hinglish profanities
  const PROFANITY_REGEX = /\b(fuck|shit|bitch|ass|asshole|cunt|dick|pussy|bastard|mc|bc|madarchod|bhenchod|chutiya|gandu|bhosadike|bhosdi|harami|kutta|bitch|slut|whore|randi|muth|bhosada)\b/gi;

  const censorText = (text: string) => {
    return text.replace(PROFANITY_REGEX, "***");
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !busId) return;

    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentMessages = messagesSentCounts.filter(m => m.timestamp > oneHourAgo);
    
    if (recentMessages.length >= 60) {
      setRateLimitMsg("Limit reached — 60 messages/hour");
      setTimeout(() => setRateLimitMsg(""), 3000);
      return;
    }
    
    // Add 3-second quick spam cooldown
    if (recentMessages.length > 0 && (now - recentMessages[recentMessages.length - 1].timestamp < 3000)) {
      setNewMessage("");
      return;
    }

    const censoredContent = censorText(newMessage.trim());
    setMessagesSentCounts([...recentMessages, { timestamp: now }]);
    const roleForMsg = currentUserRole === "admin" ? "driver" : currentUserRole;

    try {
      const messagesRef = ref(rtdb, `messages/${busId}`);
      await push(messagesRef, {
        text: censoredContent,
        from: roleForMsg,
        senderName: currentUserName || (roleForMsg === "driver" ? "Operator" : "Rider"),
        senderId: currentUserId || "anonymous",
        timestamp: serverTimestamp()
      });
      setNewMessage("");
    } catch (error) {
      console.error("Failed to send message", error);
    }
  };

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
            Bus {busId}
          </p>
        </div>
        {isOverlay && onClose && (
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
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
                  {msg.timestamp && (
                    <span className="text-[9px] font-medium" style={{ color: "var(--text-ghost)" }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            maxLength={500}
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
            disabled={!newMessage.trim()}
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
