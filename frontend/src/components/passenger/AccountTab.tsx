"use client";

import { useState } from "react";
import { CircleUserRound, LogOut, ChevronRight, LogIn, HeartHandshake, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";
import { auth } from "@/lib/firebaseAuth";

export default function AccountTab() {
  const { user, loginWithGoogle, logout } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState("");

  const requestDeletion = async () => {
    if (
      !window.confirm(
        "Permanently delete your Eki account and associated personal data? This cannot be undone.",
      )
    ) return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl || !auth.currentUser) {
      setDeletionStatus("Account deletion is unavailable until the university API is configured.");
      return;
    }
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`${backendUrl}/api/privacy/deletion-request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Deletion request failed.");
      setDeletionStatus("Deletion queued. Your account will be removed shortly.");
    } catch (error) {
      setDeletionStatus(error instanceof Error ? error.message : "Deletion request failed.");
    }
  };
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
                 // eslint-disable-next-line @next/next/no-img-element
                 <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
               ) : (
                 <CircleUserRound className="w-9 h-9" style={{ color: "var(--text-ghost)" }} />
               )}
            </div>
            
            <div className="text-center">
              {user ? (
                <>
                  <h2 className="text-xl font-extrabold tracking-tight mb-1.5" style={{ color: "var(--text-primary)" }}>
                    {user.displayName || "Rider"}
                  </h2>
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-md"
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
                  <h2 className="text-xl font-extrabold tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
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
            <>
              <button
                onClick={() => setShowLogoutConfirm(true)}
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
              {user.role === "passenger" && (
                <button
                  onClick={() => void requestDeletion()}
                  className="w-full flex items-center justify-between p-4 bg-transparent hover:bg-[var(--surface-3)] transition-colors group"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: "var(--status-danger-bg)" }}>
                      <Trash2 className="w-4 h-4" style={{ color: "var(--status-danger)" }} />
                    </div>
                    <span className="text-[13px] font-semibold" style={{ color: "var(--status-danger)" }}>
                      Delete Account
                    </span>
                  </div>
                </button>
              )}
            </>
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
        {deletionStatus && (
          <p className="text-center text-xs" role="status" style={{ color: "var(--text-secondary)" }}>
            {deletionStatus}
          </p>
        )}
        
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

      {showLogoutConfirm && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
          <div className="p-5 rounded-2xl w-[280px] text-center flex flex-col gap-4 shadow-2xl" 
               style={{ background: "var(--surface-1)", border: "1px solid var(--surface-2)" }} 
               onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-2">
              <h3 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>Sign Out?</h3>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Are you sure you want to sign out of your account?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutConfirm(false)} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                Cancel
              </button>
              <button onClick={() => { setShowLogoutConfirm(false); logout(); }} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "var(--status-danger)", color: "white" }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
