import { collection, limitToLast, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";

/**
 * The ride chat window: the latest 200 messages of one session, oldest first.
 * The chat panel and the passenger's unread badge listen to this same query,
 * so while both are attached Firestore serves them from one watch target and
 * opening the chat reads no documents again.
 */
export function rideChatMessagesQuery(sessionId: string) {
  return query(
    collection(db, "ride_sessions", sessionId, "messages"),
    orderBy("timestamp", "asc"),
    limitToLast(200),
  );
}
