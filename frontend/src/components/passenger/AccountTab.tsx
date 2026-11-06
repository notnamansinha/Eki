"use client";

import { useState } from "react";
import WorkspaceLink from "@/components/shared/WorkspaceLink";
import { CircleUserRound, LogOut, ChevronRight, LogIn, MessageSquareText, UserRoundX, ShieldUser } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import FeedbackModal from "@/components/shared/FeedbackModal";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { BUILD_DATE, BUILD_VERSION, UNIVERSITY_LINKS } from "@/config/university";

function ProfilePhoto({ photoURL }: { photoURL?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!photoURL || failed) {
    return <CircleUserRound role="img" aria-label="Default profile" className="w-10 h-10" strokeWidth={1.5} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photoURL} alt="Profile" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const roleLabel = (role?: string | null) => role ? role.charAt(0).toUpperCase() + role.slice(1) : "Passenger";

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
  const links = UNIVERSITY_LINKS.filter(link => link.href);

  const confirmDeletion = async () => {
    setIsDeleting(true);
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl || !auth.currentUser) {
      setDeletionStatus("Account deletion isn't available right now. Please try again later.");
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
    <div className="pp-page overflow-y-auto overscroll-contain">
      <div className="pp-page-inner">
        <h1 className="pp-title pp-page-title">Profile</h1>

        <section className="pp-profile-card" aria-label="Account">
          <div className="pp-avatar" role="group" aria-label="Profile photo">
            <ProfilePhoto key={JSON.stringify([user?.uid, user?.photoURL])} photoURL={user?.photoURL} />
          </div>
          <div>
            {user ? (
              <>
                <h2 className="pp-profile-name">{user.displayName || "Rider"}</h2>
                {user.email && <p className="pp-profile-email">{user.email}</p>}
                <span className="pp-role-chip">{roleLabel(user.role)}</span>
              </>
            ) : (
              <>
                <h2 className="pp-profile-name">Guest</h2>
                <p className="pp-profile-email">Sign in to save preferences</p>
              </>
            )}
          </div>
        </section>

        <div className="pp-list">
          {user?.role === "admin" && (
            <WorkspaceLink href="/admin" className="pp-list-row" data-tone="accent">
              <span className="pp-list-icon" data-tone="accent">
                <ShieldUser className="w-[18px] h-[18px]" aria-hidden="true" />
              </span>
              <span className="pp-list-label">Admin panel</span>
              <ChevronRight className="pp-list-chevron w-4 h-4" aria-hidden="true" />
            </WorkspaceLink>
          )}
          {user && (
            <button type="button" className="pp-list-row" onClick={() => setShowFeedback(true)}>
              <span className="pp-list-icon">
                <MessageSquareText className="w-[18px] h-[18px]" aria-hidden="true" />
              </span>
              <span className="pp-list-label">Send feedback</span>
              <ChevronRight className="pp-list-chevron w-4 h-4" aria-hidden="true" />
            </button>
          )}

          {user ? (
            <>
              <button type="button" className="pp-list-row" data-tone="danger" onClick={() => setShowLogoutConfirm(true)}>
                <span className="pp-list-icon" data-tone="danger">
                  <LogOut className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
                <span className="pp-list-label">Sign out</span>
                <ChevronRight className="pp-list-chevron w-4 h-4" aria-hidden="true" />
              </button>
              {user.role === "passenger" && (
                <button
                  type="button"
                  className="pp-list-row"
                  data-tone="danger"
                  onClick={() => {
                    setDeletionStatus("");
                    setShowDeleteConfirm(true);
                  }}
                >
                  <span className="pp-list-icon" data-tone="danger">
                    <UserRoundX className="w-[18px] h-[18px]" aria-hidden="true" />
                  </span>
                  <span className="pp-list-label">Delete account</span>
                  <ChevronRight className="pp-list-chevron w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="pp-list-row"
              data-tone="accent"
              onClick={loginWithGoogle}
              disabled={!loginReady || loginLoading}
            >
              <span className="pp-list-icon" data-tone="accent">
                <LogIn className="w-[18px] h-[18px]" aria-hidden="true" />
              </span>
              <span className="pp-list-label">Sign in with Google</span>
              <ChevronRight className="pp-list-chevron w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {loginError && (
          <div className="pp-banner" data-tone="danger">
            <div className="flex-1">
              <p role="alert">{loginError}</p>
              {loginFallbackAvailable && (
                <button
                  type="button"
                  onClick={loginWithGoogleRedirect}
                  className="mt-1 min-h-11 font-medium underline underline-offset-4"
                >
                  Continue with full-page sign-in
                </button>
              )}
            </div>
          </div>
        )}
        {deletionStatus && (
          <p className="pp-footnote" role="status">
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

        <footer className="pp-footnote">
          {links.length > 0 && (
            <nav aria-label="University links" className="pp-footnote-links">
              {links.map(link => <a key={link.label} href={link.href}>{link.label}</a>)}
            </nav>
          )}
          <p>
            Eki
            {BUILD_VERSION && ` · build ${BUILD_VERSION}`}
            {BUILD_DATE && ` · ${BUILD_DATE}`}
          </p>
        </footer>
      </div>

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign out?"
        description="Are you sure you want to sign out of your account?"
        confirmText="Sign out"
        icon={LogOut}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          void logout();
        }}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete account?"
        description="Permanently delete your Eki profile and login account? Your feedback, passenger ride entries, and messages will be retained. This action cannot be undone."
        confirmText="Delete account"
        cancelText="Cancel"
        variant="danger"
        icon={UserRoundX}
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
