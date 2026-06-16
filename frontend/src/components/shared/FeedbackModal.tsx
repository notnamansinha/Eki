"use client";

import { useState } from "react";
import { Star, MessageSquare, X, Send } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

interface Props {
  userId: string;
  userName: string;
  busId?: string; // If provided, this is a ride feedback. Otherwise, general suggestion.
  driverId?: string; // Links precise operational data to specific admins
  onClose: () => void;
}

export default function FeedbackModal({ userId, userName, busId, driverId, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() && rating === 0 && busId) return; // For ride, need at least rating or comment
    if (!comment.trim() && !busId) return; // For general, need comment
    
    setSubmitting(true);
    try {
      await addDoc(collection(db, "feedback"), {
        userId,
        userName,
        type: busId ? "ride" : "general",
        busId: busId || null,
        driverId: driverId || null,
        rating: busId ? rating : null,
        comment: comment.trim(),
        timestamp: serverTimestamp(),
        status: "new"
      });
      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error("Feedback error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-brand-surface border border-emerald-500/30 rounded-3xl p-8 max-w-sm w-full flex flex-col items-center text-center shadow-2xl animate-scale-up">
          <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2 font-display" style={{ fontFamily: "Outfit" }}>Thank You!</h2>
          <p className="text-sm text-white/50">Your feedback helps us improve the network.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 animate-fade-in">
      <div className="bg-brand-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-3xl flex flex-col animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${busId ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight leading-none" style={{ fontFamily: "Outfit" }}>
                {busId ? "Ride Feedback" : "System Suggestion"}
              </h2>
              {busId && <p className="text-[10px] text-white/40 uppercase tracking-widest font-black mt-1">Vehicle {busId}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-colors bg-white/5 rounded-full">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-6">
          {busId && (
            <div className="flex flex-col items-center gap-3">
              <span className="text-[10px] text-white/40 uppercase tracking-widest font-black">Rate Your Experience</span>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 focus:outline-none transition-transform hover:scale-110"
                  >
                    <Star 
                      className={`w-8 h-8 ${star <= (hoverRating || rating) ? 'fill-yellow-400 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : 'text-white/10'} transition-all`} 
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-white/40 uppercase tracking-widest font-black">
              {busId ? "Additional Comments (Optional)" : "Describe your suggestion"}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={busId ? "How was the temperature, driving, or cleanliness?" : "What features would you like to see?"}
              className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50 resize-none h-28"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || (!!busId && !comment.trim() && rating === 0) || (!busId && !comment.trim())}
            className="w-full h-12 bg-white text-brand-dark font-black tracking-widest uppercase text-xs rounded-xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? "Transmitting..." : "Submit Feedback"}
            {!submitting && <Send className="w-4 h-4 ml-1 -mr-1" />}
          </button>
        </form>
      </div>
    </div>
  );
}
