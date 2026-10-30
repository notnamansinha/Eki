// `firebase/auth` resolves here (vite.config.mts): the same synthetic adapter
// instance, served from its own URL. Nothing imports it statically, so the
// browser requests it only when useAuth loads the sign-in code, and a test can
// hold that download with page.route("**/firebaseAuthSdk.ts").
export * from "./firebase";
