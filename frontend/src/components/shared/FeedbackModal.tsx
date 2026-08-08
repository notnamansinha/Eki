"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Star, HeartHandshake, X, Send, Check } from "lucide-react";
import { auth } from "@/lib/firebaseAuth";
import { db } from "@/lib/firebaseFirestore";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { FEEDBACK_WORD_LIMIT } from "@/config/passenger";
import { useDialogFocus } from "@/hooks/useDialogFocus";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  userId: string;
  userName: string;
  busId?: string; // If provided, this is a ride feedback. Otherwise, general suggestion.
  driverId?: string; // Links precise operational data to specific admins
  sessionId?: string; // Required for server-side ride/passenger eligibility checks
  onClose: () => void;
}

const countWords = (value: string) => {
  const words = value.trim().match(/\S+/g);
  return words ? words.length : 0;
};

const trimToWordLimit = (value: string) => {
  const words = value.trim().match(/\S+/g);
  return words && words.length > FEEDBACK_WORD_LIMIT
    ? words.slice(0, FEEDBACK_WORD_LIMIT).join(" ")
    : value;
};

const formatCooldown = (ms: number) => {
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  const totalMinutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (totalHours > 0) {
    return `${totalHours}h ${totalMinutes}m`;
  }
  return `${totalMinutes}m`;
};

export default function FeedbackModal({ userId, userName, busId, driverId, sessionId, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [error, setError] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const commentId = useId();
  const feedbackStatusId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => {
    if (!submitting) onClose();
  });

  const cooldownStorageKey = `feedbackCooldown:${userId}`;
  const wordCount = countWords(comment);

  useEffect(() => {
    const updateCooldown = () => {
      try {
        const raw = localStorage.getItem(cooldownStorageKey);
        if (!raw) {
          setCooldownRemaining(0);
          return;
        }
        const lastSubmittedAt = Number(raw);
        const now = Date.now();
        const remaining = ONE_DAY_MS - (now - lastSubmittedAt);
        setCooldownRemaining(Number.isFinite(lastSubmittedAt) && remaining > 0 ? remaining : 0);
      } catch {
        setCooldownRemaining(0);
      }
    };

    updateCooldown();
    const intervalId = window.setInterval(updateCooldown, 60_000);
    return () => window.clearInterval(intervalId);
  }, [cooldownStorageKey]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!comment.trim() && rating === 0 && busId) return; // For ride, need at least rating or comment
    if (!comment.trim() && !busId) return; // For general, need comment
    if (wordCount > FEEDBACK_WORD_LIMIT) {
      setError(`Please keep feedback under ${FEEDBACK_WORD_LIMIT} words.`);
      return;
    }
    if (cooldownRemaining > 0) {
      setError(`Please wait ${formatCooldown(cooldownRemaining)} before sending feedback again.`);
      return;
    }
    
    setSubmitting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("User must be logged in to submit feedback");
      if (currentUser.uid !== userId) {
        throw new Error("Authenticated user changed before feedback submission");
      }
      if (busId && !sessionId) {
        throw new Error("Ride feedback requires a ride session");
      }
      const currentUserId = currentUser.uid;
      const submittedUserName = userName.trim().slice(0, 100) || "Rider";
      const feedbackRef = collection(db, "feedbacks");
      const cooldownRef = doc(db, "feedbackCooldowns", currentUserId);

      await runTransaction(db, async (transaction) => {
        const cooldownSnap = await transaction.get(cooldownRef);
        let lastSubmittedAt: Timestamp | undefined;

        if (cooldownSnap.exists()) {
          const data = cooldownSnap.data();
          lastSubmittedAt = data.lastSubmittedAt instanceof Timestamp
            ? data.lastSubmittedAt
            : undefined;
        }

        const now = Date.now();

        if (lastSubmittedAt) {
          const remaining = ONE_DAY_MS - (now - lastSubmittedAt.toMillis());
          if (remaining > 0) {
            throw new Error(`LIMIT_REACHED:${remaining}`);
          }
        }

        const newFeedbackDoc = doc(feedbackRef);
        transaction.set(newFeedbackDoc, {
          userId: currentUserId,
          userName: submittedUserName,
          type: busId ? "ride" : "general",
          sessionId: sessionId || null,
          busId: busId || null,
          driverId: driverId || null,
          rating: busId && rating > 0 ? rating : null,
          comment: comment.trim(),
          timestamp: serverTimestamp(),
          status: "new"
        });

        const cooldownData = {
          userId: currentUserId,
          lastSubmittedAt: serverTimestamp()
        };

        transaction.set(cooldownRef, cooldownData);
      });

      try {
        const now = Date.now();
        localStorage.setItem(`feedbackCooldown:${currentUserId}`, String(now));
        setCooldownRemaining(ONE_DAY_MS);
      } catch {}
      
      setSubmitted(true);
      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error("Feedback error:", err);
      if (err instanceof Error && err.message.startsWith("LIMIT_REACHED:")) {
        const remaining = Number(err.message.split(":")[1] || 0);
        setCooldownRemaining(remaining);
        setError(`Limit reached. Please try again in ${formatCooldown(remaining)}.`);
      } else {
        setError("Failed to send. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in"
        style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)" }}>
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="rounded-3xl p-8 max-w-sm w-full flex flex-col items-center text-center animate-scale-up relative overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)" }}>
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 to-transparent pointer-events-none" />
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30 relative z-10">
            <Check className="text-white" strokeWidth={3} size={32} />
          </div>
          <h2 id={titleId} className="text-xl font-extrabold mb-2 relative z-10" style={{ color: "var(--text-primary)" }}>
            Thank you!
          </h2>
          <p id={descriptionId} className="text-[14px] relative z-10" style={{ color: "var(--text-tertiary)" }}>
            Your feedback helps us improve the experience for everyone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-end sm:items-center justify-center pb-24 sm:pb-0 sm:p-4 animate-fade-in"
      style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)" }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col animate-slide-up relative overflow-hidden shadow-2xl"
        style={{ background: "var(--surface-1)", border: "1px solid rgba(255,255,255,0.08)" }}>
        
        {/* Subtle top gradient glow */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between p-6 relative z-10" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
              busId 
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/20' 
                : 'bg-gradient-to-br from-indigo-500 to-pink-500 shadow-indigo-500/20'
            }`}>
              <HeartHandshake className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id={titleId} className="text-[16px] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
                {busId ? "Rate your ride" : "Send feedback"}
              </h2>
              {busId && (
                <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--text-ghost)" }}>
                  Bus {busId}
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="min-w-11 min-h-11 p-2 rounded-full transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50"
            style={{ color: "var(--text-ghost)" }}
            aria-label="Close feedback">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-5">
          {/* Star Rating */}
          {busId && (
            <div className="flex flex-col items-center gap-2.5">
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-ghost)" }}>
                How was your experience?
              </span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-0.5 focus:outline-none transition-transform hover:scale-110"
                    aria-label={`Rate ${star} stars`}
                    aria-pressed={rating === star}
                  >
                    <Star 
                      className={`w-11 h-11 transition-all ${
                        star <= (hoverRating || rating) 
                          ? 'fill-amber-400 text-amber-400' 
                          : ''
                      }`}
                      style={{
                        color: star <= (hoverRating || rating) ? "#FBBF24" : "var(--surface-4)",
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comment */}
          <div className="flex flex-col gap-2">
            <label htmlFor={commentId} className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "var(--text-ghost)" }}>
              {busId ? "Comments (optional)" : "What's on your mind?"}
            </label>
            <div className="relative group">
              <textarea
                id={commentId}
                aria-describedby={feedbackStatusId}
                aria-invalid={Boolean(error)}
                value={comment}
                onChange={(e) => {
                  const nextComment = e.target.value;
                  if (countWords(nextComment) > FEEDBACK_WORD_LIMIT) {
                    setComment(trimToWordLimit(nextComment));
                    setError(`Limited to ${FEEDBACK_WORD_LIMIT} words.`);
                  } else {
                    setComment(nextComment);
                    setError("");
                  }
                }}
                maxLength={2000}
                placeholder={busId ? "Temperature, driving, cleanliness…" : "Suggestions, ideas, bugs…"}
                className="w-full rounded-2xl p-4 text-[14px] focus:outline-none resize-none h-32 transition-all placeholder:text-white/20"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  color: "var(--text-primary)",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)"
                }}
              />
              <div className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity opacity-0 group-focus-within:opacity-100" 
                style={{ border: "1px solid rgba(99, 102, 241, 0.3)", boxShadow: "0 0 0 4px rgba(99, 102, 241, 0.1)" }} />
            </div>
            
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold px-1 mt-1">
              <span id={feedbackStatusId} role="status" aria-live="polite" style={{ color: error ? "#F87171" : "var(--text-ghost)" }} className="transition-colors">
                {error || (cooldownRemaining > 0
                  ? `Wait ${formatCooldown(cooldownRemaining)}`
                  : "Ready")}
              </span>
              <span style={{ color: wordCount >= FEEDBACK_WORD_LIMIT ? "#FBBF24" : "var(--text-ghost)" }} className="transition-colors">
                {wordCount} / {FEEDBACK_WORD_LIMIT} words
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || cooldownRemaining > 0 || (!!busId && !comment.trim() && rating === 0) || (!busId && !comment.trim())}
            className="w-full h-12 rounded-xl font-semibold text-[14px] flex items-center justify-center gap-2 transition-all relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              background: (submitting || cooldownRemaining > 0 || (!!busId && !comment.trim() && rating === 0) || (!busId && !comment.trim()))
                ? "var(--surface-3)" 
                : "linear-gradient(135deg, #6366f1 0%, #ec4899 100%)",
              color: "white",
              boxShadow: (submitting || cooldownRemaining > 0 || (!!busId && !comment.trim() && rating === 0) || (!busId && !comment.trim()))
                ? "none"
                : "0 10px 25px -5px rgba(99, 102, 241, 0.4)",
            }}
          >
            <div className="absolute inset-0 bg-white/20 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 pointer-events-none" />
            <span className="relative z-10 flex items-center gap-2">
              {submitting ? "Sending…" : cooldownRemaining > 0 ? `Wait ${formatCooldown(cooldownRemaining)}` : "Submit Feedback"}
              {!submitting && <Send className="w-4 h-4" />}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
