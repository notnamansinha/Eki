"use client";

import { useState, useEffect, useRef } from "react";
import { rtdb } from "@/lib/firebase";
import { ref, push, onValue, serverTimestamp } from "firebase/database";
import { Send, X, User } from "lucide-react";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenCountRef = useRef(0);

  useEffect(() => {
    if (!busId) return;

    const messagesRef = ref(rtdb, `messages/${busId}`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgs = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(msgs);

        // Count messages from others to surface unread badge
        if (onUnreadCountChange) {
          const othersCount = msgs.filter((m: any) => m.senderId !== currentUserId).length;
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
    });

    return () => unsubscribe();
  }, [busId]);

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
      alert("Rate limit exceeded: Maximum 60 messages per hour. Please try again later.");
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
    <div className={`flex flex-col h-full bg-brand-surface border border-white/5 shadow-2xl relative ${isOverlay ? 'rounded-t-[2rem]' : 'rounded-2xl'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5 bg-brand-dark/40 backdrop-blur-xl">
        <div>
          <h3 className="font-bold text-white tracking-tight flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Comms
          </h3>
          <p className="text-[10px] text-white/40 font-black uppercase tracking-widest mt-0.5">
            Node: {busId}
          </p>
        </div>
        {isOverlay && onClose && (
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 gap-4 flex flex-col bg-brand-dark/20 text-sm">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20">
            <User className="w-8 h-8 mb-3 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-center">Secure Channel Established<br/>Awaiting Comms...</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId || (currentUserRole === 'driver' && msg.from === 'driver');
            
            return (
              <div 
                key={msg.id} 
                className={`flex flex-col max-w-[85%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
              >
                <div className={`flex items-baseline gap-2 mb-1 px-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${isMe ? 'text-emerald-400/80' : 'text-white/40'}`}>
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  {msg.timestamp && (
                    <span className="text-[8px] font-mono tracking-widest text-white/20">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div 
                  className={`px-4 py-2.5 rounded-2xl ${
                    isMe 
                      ? 'bg-emerald-500 text-white rounded-tr-sm' 
                      : 'bg-white/10 text-white rounded-tl-sm border border-white/5'
                  }`}
                >
                  <p className="leading-relaxed whitespace-pre-wrap font-medium">{msg.text}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-white/5 bg-brand-dark/40 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Transmit message..."
            className="flex-1 bg-white/5 border border-white/10 h-12 rounded-xl px-4 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all font-medium text-sm"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-emerald-400 active:scale-95 transition-all shadow-xl"
          >
            <Send className="w-5 h-5 ml-1" />
          </button>
        </div>
      </form>
    </div>
  );
}
