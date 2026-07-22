import { getFirestore } from "firebase/firestore";
import { firebaseApp } from "./firebaseCore";

export const db = getFirestore(firebaseApp);
