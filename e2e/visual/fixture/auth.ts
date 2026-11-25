// The landing page is the signed-out screen; every other surface is signed in
// as the synthetic passenger, or as the administrator with `?role=admin`.
import { useAuth as useSignedInAuth } from "../../production-audit/state";

const signedOut = new URLSearchParams(location.search).get("surface") === "landing";

export function useAuth() {
  const auth = useSignedInAuth();
  return signedOut ? { ...auth, user: null, restoreSlow: false, refreshAccess: async () => {} } : auth;
}
