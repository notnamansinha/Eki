"use client";

import { useEffect, useRef, useState } from "react";
import WorkspaceLink from "@/components/shared/WorkspaceLink";
import { CircleUserRound, LogOut, ChevronRight, LogIn, HeartHandshake, Trash2, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { PASSENGER_NAV_HEIGHT_PX } from "./passengerFrame";

function ProfilePhoto({ photoURL }: { photoURL?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!photoURL || failed) {
    return <CircleUserRound role="img" aria-label="Default profile" className="w-9 h-9" style={{ color: "var(--text-ghost)" }} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photoURL} alt="Profile" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="w-full h-full object-cover" />;
}

export default function AccountTab() {
  const {
    user,
    loginReady,
    loginError,
    loginFallbackAvailable,
    loginLoading,
    loginWithGoogle,
    loginWithGoogleRedirect,
    logout,
  } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);
  // Unsent feedback survives closing the dialog, but only for the account that wrote it.
  const [feedbackDraft, setFeedbackDraft] = useState({ uid: "", comment: "" });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeletionAccepted, setShowDeletionAccepted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState("");
  const [showCoin, setShowCoin] = useState(false);
  const lastPhotoTap = useRef<number | null>(null);
  const coinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (coinTimer.current) clearTimeout(coinTimer.current);
  }, []);

  const handlePhotoTap = () => {
    const now = Date.now();
    if (lastPhotoTap.current !== null && now - lastPhotoTap.current <= 350 && !showCoin) {
      setShowCoin(true);
      lastPhotoTap.current = null;
      coinTimer.current = setTimeout(() => {
        setShowCoin(false);
        lastPhotoTap.current = null;
        coinTimer.current = null;
      }, 4_000);
    } else if (!showCoin) {
      lastPhotoTap.current = now;
    }
  };

  const confirmDeletion = async () => {
    setIsDeleting(true);
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl || !auth.currentUser) {
      setDeletionStatus("Account deletion is unavailable until the university API is configured.");
      setShowDeleteConfirm(false);
      setIsDeleting(false);
      return;
    }
    try {
      const token = await auth.currentUser.getIdToken();
      const result = await apiRequest<{ accepted?: boolean }>("/api/v2/privacy-deletion-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        fallbackError: "Deletion request failed.",
      });
      if (result?.accepted !== true) throw new Error("Deletion acknowledgement is missing.");
      setDeletionStatus("");
      setShowDeleteConfirm(false);
      setShowDeletionAccepted(true);
    } catch (error) {
      setDeletionStatus(error instanceof Error ? error.message : "Deletion request failed.");
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };
  const dismissDeletionAccepted = () => {
    setShowDeletionAccepted(false);
    void logout();
  };
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col pt-safe px-5" style={{ background: "var(--surface-0)" }}>
      {/* Scroll past the navigation and its safe area, plus the previous 47px breathing room. */}
      <div
        className="w-full max-w-lg mx-auto space-y-6 mt-10"
        style={{ paddingBottom: `calc(${PASSENGER_NAV_HEIGHT_PX + 47}px + var(--safe-area-bottom))` }}
      >
        
        {/* Profile Header */}
        <div className="p-6 rounded-2xl relative overflow-hidden" 
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex flex-col items-center gap-5 relative z-10">
            <div className="w-20 h-20 rounded-full flex items-center justify-center"
              role="group" aria-label="Profile photo"
              >
              <button type="button" onClick={handlePhotoTap}
                aria-label="Profile photo, double tap for a surprise"
                className="relative w-full h-full rounded-full flex items-center justify-center overflow-hidden touch-manipulation"
                style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)", perspective: "500px" }}>
                {showCoin ? (
                  <span className="profile-coin" role="img" aria-label="Golden coin: 19">
                    <span className="profile-coin-face profile-coin-front" aria-hidden="true" />
                    <span className="profile-coin-face profile-coin-back" aria-hidden="true">19</span>
                  </span>
                ) : <ProfilePhoto key={JSON.stringify([user?.uid, user?.photoURL])} photoURL={user?.photoURL} />}
              </button>
            </div>
            
            <div className="text-center">
              {user ? (
                <>
                  <h2 className="text-xl font-extrabold tracking-tight mb-1.5" style={{ color: "var(--text-primary)" }}>
                    {user.displayName || "Rider"}
                  </h2>
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-md"
                    style={{ 
                      background: "var(--accent-subtle)",
                      color: "var(--accent)",
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
          {user?.role === "admin" && (
            <WorkspaceLink
              href="/admin"
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--surface-3)] transition-colors group active:bg-[var(--surface-4)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--accent-subtle)" }}>
                  <LayoutDashboard className="w-4 h-4" aria-hidden="true" style={{ color: "var(--accent)" }} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Admin Panel
                </span>
              </div>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true" style={{ color: "var(--text-ghost)" }} />
            </WorkspaceLink>
          )}
          {user && <button
            type="button"
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
          </button>}

          {user ? (
            <>
              <button
                type="button"
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
                <ChevronRight className="w-4 h-4" aria-hidden="true" style={{ color: "var(--text-ghost)" }} />
              </button>
              {user.role === "passenger" && (
                <button
                  type="button"
                  onClick={() => {
                    setDeletionStatus("");
                    setShowDeleteConfirm(true);
                  }}
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
                  <ChevronRight className="w-4 h-4" aria-hidden="true" style={{ color: "var(--text-ghost)" }} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={loginWithGoogle}
              disabled={!loginReady || loginLoading}
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
        {loginError && (
          <div className="px-4 pb-4">
            <p className="text-sm" style={{ color: "var(--status-danger)" }} role="alert">
              {loginError}
            </p>
            {loginFallbackAvailable && (
              <button
                type="button"
                onClick={loginWithGoogleRedirect}
                className="mt-2 text-sm font-semibold underline underline-offset-4"
                style={{ color: "var(--text-primary)" }}
              >
                Continue with full-page sign-in
              </button>
            )}
          </div>
        )}
        {deletionStatus && (
          <p className="text-center text-xs" role="status" style={{ color: "var(--text-secondary)" }}>
            {deletionStatus}
          </p>
        )}
        
        {showFeedback && user && (
          <FeedbackModal
            userId={user.uid}
            draft={feedbackDraft.uid === user.uid ? feedbackDraft.comment : ""}
            onDraftChange={comment => setFeedbackDraft({ uid: user.uid, comment })}
            onClose={() => setShowFeedback(false)}
          />
        )}
        
        {/* Version */}
        <p className="text-center text-[10px] font-semibold pt-4" style={{ color: "var(--text-ghost)" }}>
          Eki Transit · v3.0
        </p>
      </div>

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign out?"
        description="Are you sure you want to sign out of your account?"
        confirmText="Sign out"
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          void logout();
        }}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Account?"
        description="Permanently delete your Eki profile and login account? Your feedback, passenger ride entries, and messages will be retained. This action cannot be undone."
        confirmText="Delete Account"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeletion}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmModal
        isOpen={showDeletionAccepted}
        title="Deletion requested"
        description="Your account deletion request has been queued. You will now be signed out. Your feedback, passenger ride entries, and messages will be retained."
        confirmText="OK"
        showCancel={false}
        variant="info"
        onConfirm={dismissDeletionAccepted}
        onCancel={dismissDeletionAccepted}
      />
    </div>
  );
}
