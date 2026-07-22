import { getDatabase } from "firebase/database";
import { firebaseApp } from "./firebaseCore";

export const rtdb = getDatabase(firebaseApp);
