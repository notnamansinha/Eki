// Synthetic Firebase Auth boundary. Panels compare `auth.currentUser.uid` with
// the signed-in user before loading, so it must carry the fixture identity.
import { qaUser } from "../../fixtures/state";

export const auth = {
  get currentUser() { return { uid: qaUser.uid, getIdToken: async () => "visual-token" }; },
};
