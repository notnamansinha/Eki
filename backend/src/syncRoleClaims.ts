import { auth, db } from "./lib/firebaseAdmin";

const roles = new Set(["passenger", "driver", "admin"]);

async function syncRoleClaims() {
  const users = await db.collection("users").get();
  let updated = 0;

  for (const user of users.docs) {
    const role = user.data().role;
    if (typeof role !== "string" || !roles.has(role)) {
      console.warn(`Skipping ${user.id}: invalid role`);
      continue;
    }

    const existingClaims = (await auth.getUser(user.id)).customClaims ?? {};
    const { admin: _previousAdminClaim, ...preservedClaims } = existingClaims;

    // Keep unrelated claims intact and synchronize the legacy `admin` claim
    // used by protected backend routes with the Firestore role.
    await auth.setCustomUserClaims(user.id, {
      ...preservedClaims,
      role,
      ...(role === "admin" ? { admin: true } : {}),
    });
    updated += 1;
  }

  console.log(`Synchronized role claims for ${updated} users.`);
}

syncRoleClaims().catch((error) => {
  console.error("Failed to synchronize role claims:", error);
  process.exitCode = 1;
});
