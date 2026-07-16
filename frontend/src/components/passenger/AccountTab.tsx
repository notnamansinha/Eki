"use client";

import { useState } from "react";
import { ChevronRight, CircleUserRound, HeartHandshake, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" {...props}>
    <path
      fill="#EA4335"
      d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"
    />
    <path
      fill="#34A853"
      d="M16.04 15.345c-1.077.733-2.433 1.164-4.04 1.164a7.076 7.076 0 0 1-6.734-4.856L1.24 14.77C3.198 18.72 7.27 21.42 12 21.42c3.118 0 5.864-1.01 7.82-2.755l-3.78-3.32Z"
    />
    <path
      fill="#4285F4"
      d="M23.49 12.275c0-.79-.07-1.54-.19-2.275H12v4.51h6.46c-.29 1.48-1.14 2.73-2.42 3.56l3.78 3.32c2.21-2.01 3.67-4.96 3.67-8.565Z"
    />
    <path
      fill="#FBBC05"
      d="M5.266 12.275c0-.878.147-1.722.418-2.51L1.24 6.65a11.933 11.933 0 0 0 0 11.24l4.026-3.115a7.03 7.03 0 0 1-.418-2.51Z"
    />
  </svg>
);

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
                 // eslint-disable-next-line @next/next/no-img-element
                 <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 shrink-0">
                   <GoogleIcon className="w-4 h-4" />
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
