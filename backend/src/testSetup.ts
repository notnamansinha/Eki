// Keep pure unit tests independent of a developer .env file and production
// Firebase configuration. Emulator tests provide their own host separately.
if (!process.env.FIREBASE_DATABASE_URL) {
  process.env.FIREBASE_DATABASE_URL = "https://eki-unit-test-default-rtdb.firebaseio.com";
}
