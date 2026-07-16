"use client";

import { useState } from "react";
import { CircleUserRound, LogOut, ChevronRight, LogIn, HeartHandshake } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";

export default function AccountTab() {
  const { user, loginWithGoogle, logout } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);
  return (
    <div className="flex-1 overflow-y-auto flex flex-col pt-safe px-5" style={{ background: "var(--surface-0)" }}>
      <div className="w-full max-w-lg mx-auto space-y-6 mt-10 pb-32">
        
        {/* Profile Header */}
        <div className="p-6 rounded-2xl relative overflow-hidden" 
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex flex-col items-center gap-5 relative z-10">
            <div className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden"
              style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)" }}>
               {user?.photoURL ? (
                 <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
               ) : (
                 <CircleUserRound className="w-9 h-9" style={{ color: "var(--text-ghost)" }} />
               )}
            </div>
            
            <div className="text-center">
              {user ? (
                <>
                  <h2 className="text-xl font-bold tracking-tight mb-1.5" style={{ color: "var(--text-primary)" }}>
                    {user.displayName || "Rider"}
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md"
                    style={{ 
                      background: "rgba(59, 130, 246, 0.10)", 
                      color: "#60A5FA",
                      letterSpacing: "0.05em" 
                    }}>
                    {user.role?.toUpperCase() || "PASSENGER"}
                  </span>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
                    Guest
                  </h2>
                  <span className="text-[10px] font-semibold" style={{ color: "var(--text-ghost)" }}>
                    Sign in to save preferences
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions List */}
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => setShowFeedback(true)}
            className="w-full flex items-center justify-between p-4 bg-transparent hover:bg-[var(--surface-3)] transition-colors group active:bg-[var(--surface-4)]"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                style={{ background: "var(--surface-3)" }}>
                  <HeartHandshake className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
              </div>
              <span className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                Send Feedback
              </span>
            </div>
            <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" 
              style={{ color: "var(--text-ghost)" }} />
          </button>

          {user ? (
            <button
              onClick={logout}
              className="w-full flex items-center justify-between p-4 bg-transparent hover:bg-[var(--surface-3)] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--status-danger-bg)" }}>
                   <LogOut className="w-4 h-4" style={{ color: "var(--status-danger)" }} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: "var(--status-danger)" }}>
                  Sign Out
                </span>
              </div>
            </button>
          ) : (
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-between p-4 bg-transparent hover:bg-[var(--surface-3)] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(59, 130, 246, 0.10)" }}>
                   <LogIn className="w-4 h-4" style={{ color: "#3B82F6" }} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: "#3B82F6" }}>
                  Sign in with Google
                </span>
              </div>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" 
                style={{ color: "var(--text-ghost)" }} />
            </button>
          )}
        </div>
        
        {showFeedback && (
          <FeedbackModal
            userId={user?.uid || "anonymous"}
            userName={user?.displayName || "Guest"}
            onClose={() => setShowFeedback(false)}
          />
        )}
        
        {/* Version */}
        <p className="text-center text-[10px] font-semibold pt-4" style={{ color: "var(--text-ghost)" }}>
          Eki Transit · v3.0
        </p>
      </div>
    </div>
  );
}
