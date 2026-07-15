"use client";

import { useEffect, useState } from "react";
import { Star, MessageSquare, X, Send } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { FEEDBACK_COOLDOWN_MS, FEEDBACK_WORD_LIMIT } from "@/config/passenger";

interface Props {
  userId: string;
  userName: string;
  busId?: string; // If provided, this is a ride feedback. Otherwise, general suggestion.
  driverId?: string; // Links precise operational data to specific admins
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
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default function FeedbackModal({ userId, userName, busId, driverId, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [error, setError] = useState("");

  const resolvedUserId = auth.currentUser?.uid ?? userId;
  const cooldownStorageKey = `feedbackCooldown:${resolvedUserId}`;
  const wordCount = countWords(comment);

  useEffect(() => {
    const updateCooldown = () => {
      const lastSubmittedAt = Number(localStorage.getItem(cooldownStorageKey) || 0);
      setCooldownRemaining(Math.max(0, FEEDBACK_COOLDOWN_MS - (Date.now() - lastSubmittedAt)));
    };

    updateCooldown();
    const intervalId = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(intervalId);
  }, [cooldownStorageKey]);

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
      const currentUser = auth.currentUser || (await signInAnonymously(auth)).user;
      const currentUserId = currentUser.uid;
      const cooldownRef = doc(db, "feedbackCooldowns", currentUserId);
      const feedbackRef = doc(collection(db, "feedbacks"));

      await runTransaction(db, async (transaction) => {
        const cooldownSnap = await transaction.get(cooldownRef);
        const lastSubmittedAt = cooldownSnap.exists()
          ? cooldownSnap.data().lastSubmittedAt as Timestamp | undefined
          : undefined;

        if (lastSubmittedAt) {
          const remaining = FEEDBACK_COOLDOWN_MS - (Date.now() - lastSubmittedAt.toMillis());
          if (remaining > 0) {
            throw new Error(`COOLDOWN:${remaining}`);
          }
        }

        transaction.set(feedbackRef, {
          userId: currentUserId,
          userName,
          type: busId ? "ride" : "general",
          busId: busId || null,
          driverId: driverId || null,
          rating: busId && rating > 0 ? rating : null,
          comment: comment.trim(),
          timestamp: serverTimestamp(),
          status: "new"
        });

        transaction.set(cooldownRef, {
          userId: currentUserId,
          lastSubmittedAt: serverTimestamp()
        }, { merge: true });
      });

      localStorage.setItem(`feedbackCooldown:${currentUserId}`, Date.now().toString());
      setCooldownRemaining(FEEDBACK_COOLDOWN_MS);
      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error("Feedback error:", err);
      if (err instanceof Error && err.message.startsWith("COOLDOWN:")) {
        const remaining = Number(err.message.split(":")[1] || 0);
        setCooldownRemaining(remaining);
        setError(`Please wait ${formatCooldown(remaining)} before sending again.`);
      } else {
        setError("Failed to send. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
        style={{ background: "rgba(0, 0, 0, 0.6)" }}>
        <div className="rounded-2xl p-8 max-w-sm w-full flex flex-col items-center text-center animate-scale-up"
          style={{ background: "var(--surface-2)", border: "1px solid rgba(52, 211, 153, 0.2)" }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
            style={{ background: "var(--status-live-bg)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--status-live)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-1.5" style={{ color: "var(--text-primary)" }}>
            Thank you
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Your feedback helps us improve.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 animate-fade-in"
      style={{ background: "rgba(0, 0, 0, 0.6)" }}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col animate-slide-up"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: busId ? "rgba(59,130,246,0.10)" : "var(--status-live-bg)" }}>
              <MessageSquare className="w-4 h-4" style={{ color: busId ? "#60A5FA" : "var(--status-live)" }} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold leading-none" style={{ color: "var(--text-primary)" }}>
                {busId ? "Rate your ride" : "Send feedback"}
              </h2>
              {busId && (
                <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--text-ghost)" }}>
                  Bus {busId}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-ghost)", background: "var(--surface-3)" }}
            aria-label="Close feedback">
            <X className="w-4 h-4" />
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
                  >
                    <Star 
                      className={`w-8 h-8 transition-all ${
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
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-ghost)" }}>
              {busId ? "Comments (optional)" : "What's on your mind?"}
            </span>
            <textarea
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
              className="w-full rounded-xl p-3.5 text-[13px] focus:outline-none resize-none h-24 transition-colors"
              style={{
                background: "var(--surface-3)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
            <div className="flex items-center justify-between gap-3 text-[10px] font-semibold">
              <span style={{ color: error ? "var(--status-danger)" : "var(--text-ghost)" }}>
                {error || (cooldownRemaining > 0
                  ? `Wait ${formatCooldown(cooldownRemaining)}`
                  : "Ready")}
              </span>
              <span style={{ color: wordCount >= FEEDBACK_WORD_LIMIT ? "var(--status-warning)" : "var(--text-ghost)" }}>
                {wordCount}/{FEEDBACK_WORD_LIMIT}
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || cooldownRemaining > 0 || (!!busId && !comment.trim() && rating === 0) || (!busId && !comment.trim())}
            className="w-full h-11 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
            style={{ background: "var(--text-primary)", color: "var(--surface-0)" }}
          >
            {submitting ? "Sending…" : cooldownRemaining > 0 ? `Wait ${formatCooldown(cooldownRemaining)}` : "Submit"}
            {!submitting && <Send className="w-3.5 h-3.5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
