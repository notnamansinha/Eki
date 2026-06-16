"use client";

import { useAuth, UserRole } from "@/hooks/useAuth";
import { Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { user, loading, loginWithGoogle, logout } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  // Hard 6-second bail-out: if still loading after 6s, stop and show login
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Once auth resolves, reset the timeout flag
  useEffect(() => {
    if (!loading) setTimedOut(false);
  }, [loading]);

  if (loading && !timedOut) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#1d1d1f]">
        <Loader2 className="w-8 h-8 text-white/40 animate-spin mb-4" />
        <p className="text-white/60 font-medium tracking-tight">Authenticating...</p>
      </div>
    );
  }

  if (!user || timedOut) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#1d1d1f] text-white px-6 text-center">
        <ShieldAlert className="w-16 h-16 text-blue-500 mb-6" />
        <h1 className="text-3xl font-bold tracking-tight mb-4 text-[#f5f5f7]">Access Restricted</h1>
        <p className="text-[#86868b] max-w-sm mb-8 leading-relaxed">
          Please sign in to verify your access privileges for this section of the network.
        </p>
        <button
          onClick={loginWithGoogle}
          className="bg-[#0071e3] hover:bg-[#0077ed] text-white px-8 py-3 rounded-full font-medium transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#1d1d1f] text-white px-6 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-6" />
        <h1 className="text-3xl font-bold tracking-tight mb-4 text-[#f5f5f7]">Unauthorized Role</h1>
        <p className="text-[#86868b] max-w-sm mb-8 leading-relaxed">
          Your account <span className="text-white/80">({user.email})</span> does not have access to this panel.
          <br />
          Current Role: <span className="text-[#f5f5f7] font-bold uppercase">{user.role}</span>
        </p>
        <div className="flex gap-4 border-t border-white/10 pt-8 mt-4">
          <button
            onClick={logout}
            className="text-[#86868b] hover:text-white transition-colors text-sm font-medium"
          >
            Sign out
          </button>
          <a
            href="/"
            className="text-[#0071e3] hover:text-[#0077ed] transition-colors text-sm font-bold"
          >
            Return to Home
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
