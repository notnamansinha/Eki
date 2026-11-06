"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star, BusFront, ClipboardPenLine, X, Send, Check } from "lucide-react";
import { auth } from "@/lib/firebaseAuth";
import { FEEDBACK_WORD_LIMIT } from "@/config/passenger";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { feedbackErrorMessage, submitFeedback } from "@/lib/feedbackStore";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  userId: string;
  busId?: string; // If provided, this is a ride feedback. Otherwise, general suggestion.
  driverId?: string; // Links precise operational data to specific admins
  sessionId?: string; // Required for Firestore ride/passenger eligibility checks
  draft?: string; // Unsent comment kept by the opener across close/reopen
  onDraftChange?: (comment: string) => void;
  onClose: () => void;
}

const countWords = (value: string) => {
  const words = value.trim().match(/\S+/g);
  return words ? words.length : 0;
};

const trimToWordLimit = (value: string) => {
  // Cut after the last allowed word so pasted line breaks and spacing survive.
  const limited = value.match(new RegExp(`^\\s*(?:\\S+\\s+){${FEEDBACK_WORD_LIMIT - 1}}\\S+`));
  return limited ? limited[0] : value;
};

const formatCooldown = (ms: number) => {
  // Round up so the final minute reads "1m" instead of an impossible "0m" wait.
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const readStoredCooldownUntil = (storageKey: string) => {
  try {
    const raw = localStorage.getItem(storageKey);
    const lastSubmittedAt = raw ? Number(raw) : Number.NaN;
    // A stamp from a clock that was ahead must not lock feedback beyond one day.
    return Number.isFinite(lastSubmittedAt) ? Math.min(Date.now(), lastSubmittedAt) + ONE_DAY_MS : 0;
  } catch {
    return 0;
  }
};

export default function FeedbackModal({ userId, busId, driverId, sessionId, draft, onDraftChange, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setCommentState] = useState(draft ?? "");
  const setComment = (next: string) => {
    setCommentState(next);
    onDraftChange?.(next);
  };
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  // Cooldown end set by this modal; kept even when localStorage is unavailable.
  const [cooldownDeadline, setCooldownDeadline] = useState({ storageKey: "", until: 0 });
  const [error, setError] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFeedbackRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const commentId = useId();
  const feedbackStatusId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => {
    if (!submitting) onClose();
  });

  const cooldownStorageKey = `feedbackCooldown:${userId}`;
  const wordCount = countWords(comment);

  const localDeadline = cooldownDeadline.storageKey === cooldownStorageKey ? cooldownDeadline.until : 0;
  useEffect(() => {
    let timerId: number | undefined;
    const updateCooldown = () => {
      const until = Math.max(localDeadline, readStoredCooldownUntil(cooldownStorageKey));
      const remaining = Math.max(0, until - Date.now());
      setCooldownRemaining(remaining);
      // Refresh the label each minute and re-check exactly when the cooldown ends.
      if (remaining > 0) timerId = window.setTimeout(updateCooldown, Math.min(remaining, 60_000));
    };

    updateCooldown();
    return () => window.clearTimeout(timerId);
  }, [cooldownStorageKey, localDeadline]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!comment.trim() && (rating === 0 || !busId)) {
      setError(busId ? "Please add a rating or comment before submitting." : "Please add a comment before submitting.");
      return;
    }
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

      const payload = {
        type: busId ? "ride" as const : "general" as const,
        sessionId: sessionId || undefined,
        busId: busId || undefined,
        driverId: driverId || undefined,
        rating: busId && rating > 0 ? rating : null,
        comment: comment.trim(),
      };
      const fingerprint = JSON.stringify(payload);
      const pending = pendingFeedbackRef.current?.fingerprint === fingerprint
        ? pendingFeedbackRef.current
        : { fingerprint, requestId: crypto.randomUUID() };
      pendingFeedbackRef.current = pending;
      await submitFeedback(userId, payload, pending.requestId);
      pendingFeedbackRef.current = null;

      try {
        const now = Date.now();
        setCooldownRemaining(ONE_DAY_MS);
        setCooldownDeadline({ storageKey: cooldownStorageKey, until: now + ONE_DAY_MS });
        localStorage.setItem(cooldownStorageKey, String(now));
      } catch {}
      
      onDraftChange?.("");
      setSubmitted(true);
      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error("Feedback error:", err);
      const status = err instanceof Error && "status" in err
        ? Number((err as { status?: number }).status)
        : 0;
      if (status === 409) pendingFeedbackRef.current = null;
      if (err instanceof Error && "retryAfterMs" in err && typeof (err as { retryAfterMs?: number }).retryAfterMs === "number") {
        const remaining = Math.min(ONE_DAY_MS, Math.max(0, (err as { retryAfterMs?: number }).retryAfterMs ?? 0));
        setCooldownRemaining(remaining);
        setCooldownDeadline({ storageKey: cooldownStorageKey, until: Date.now() + remaining });
        // Persist the server cooldown so the minute refresh and a reopen keep it.
        try {
          localStorage.setItem(cooldownStorageKey, String(Date.now() - (ONE_DAY_MS - remaining)));
        } catch {}
        setError(`Limit reached. Please try again in ${formatCooldown(remaining)}.`);
      } else if (status === 429) {
        // The rules denied a cooldown the device clock could not measure; nothing reliable to store.
        setError("Feedback limit reached. You can send feedback once every 24 hours.");
      } else {
        setError(feedbackErrorMessage(err, "Failed to send. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Portal to the document so no workspace stacking context (such as the
  // passenger Profile view) can leave its navigation above this backdrop.
  if (submitted) {
    return createPortal(
      <div className="pp-dialog-backdrop fixed inset-0 animate-fade-in">
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="pp-dialog animate-scale-up">
          <div className="pp-success">
            <div className="pp-success-icon">
              <Check strokeWidth={2.5} size={30} aria-hidden="true" />
            </div>
            <h2 id={titleId} className="pp-dialog-title">
              Thank you!
            </h2>
            <p id={descriptionId} className="pp-subtitle">
              Your feedback helps us improve the experience for everyone.
            </p>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const blocked = submitting || cooldownRemaining > 0 || (!busId && !comment.trim());
  const shownRating = hoverRating || rating;
  return createPortal(
    <div className="pp-dialog-backdrop fixed inset-0 animate-fade-in">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="pp-dialog animate-slide-up">
        <div className="pp-dialog-header">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="pp-dialog-icon">
              {busId ? <BusFront className="w-5 h-5" aria-hidden="true" /> : <ClipboardPenLine className="w-5 h-5" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="pp-dialog-title">
                {busId ? "Rate your ride" : "Send feedback"}
              </h2>
              {busId && (
                <p className="pp-dialog-subtitle">
                  Bus {busId}
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="pp-close disabled:opacity-50"
            aria-label="Close feedback">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="pp-dialog-body">
          {/* Star Rating */}
          {busId && (
            <div className="flex flex-col gap-2">
              <p className="pp-rating-label">
                How was your experience?
              </p>
              <div className="pp-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="pp-star"
                    data-on={star <= shownRating}
                    aria-label={`Rate ${star} ${star === 1 ? "star" : "stars"}`}
                    aria-pressed={rating === star}
                  >
                    <Star aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comment */}
          <div className="flex flex-col gap-2">
            <label htmlFor={commentId} className="pp-field-label">
              {busId ? "Comments (optional)" : "What's on your mind?"}
            </label>
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
              className="pp-textarea"
            />

            <div className="pp-field-meta">
              <span id={feedbackStatusId} role="status" aria-live="polite" data-tone={error ? "danger" : undefined}>
                {error || (cooldownRemaining > 0
                  ? `Wait ${formatCooldown(cooldownRemaining)}`
                  : "Ready")}
              </span>
              <span data-tone={wordCount >= FEEDBACK_WORD_LIMIT ? "warning" : undefined}>
                {wordCount} / {FEEDBACK_WORD_LIMIT} words
              </span>
            </div>
          </div>

          <button type="submit" disabled={blocked} className="pp-btn-primary w-full">
            {submitting ? "Sending…" : cooldownRemaining > 0 ? `Wait ${formatCooldown(cooldownRemaining)}` : "Submit feedback"}
            {!submitting && <Send className="w-4 h-4" aria-hidden="true" />}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
