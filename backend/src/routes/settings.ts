import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../middleware/requireAdmin";
import { db } from "../lib/firebaseAdmin";

const router = Router();
export const settingsV2Router = Router();

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
    admin?: boolean;
  };
};

const STRING_LIMITS: Record<string, number> = {
  serviceStartTime: 64,
  noBusesMessage: 200,
  noBusesSubMessage: 300,
  announcementText: 500,
};

/**
 * PUT /api/settings
 *
 * Server-authoritative settings save. The admin panel previously wrote
 * `settings/global` from the client; the backend now validates the shape and
 * persists it (admin claim enforced by requireAdmin).
 */
const updateSettings = async (req: AuthenticatedRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    const partial = req.body ?? {};
    if (typeof partial !== "object" || Array.isArray(partial) || partial === null) {
      res.status(400).json({ error: "Invalid settings payload." });
      return;
    }

    const allowedKeys = new Set([
      "serviceStartTime",
      "noBusesMessage",
      "noBusesSubMessage",
      "announcementText",
      "announcementActive",
    ]);
    for (const key of Object.keys(partial)) {
      if (!allowedKeys.has(key)) {
        res.status(400).json({ error: `Unknown setting: ${key}` });
        return;
      }
    }
    if (Object.keys(partial).length === 0) {
      res.status(400).json({ error: "At least one setting is required." });
      return;
    }

    const sanitized: Record<string, string | boolean> = {};
    if (Object.hasOwn(partial, "announcementActive")) {
      if (typeof partial.announcementActive !== "boolean") {
        res.status(400).json({ error: "announcementActive must be a boolean." });
        return;
      }
      sanitized.announcementActive = partial.announcementActive;
    }
    // Destination keys come from the server-owned schema, never request keys.
    for (const [key, maximumLength] of Object.entries(STRING_LIMITS)) {
      if (!Object.hasOwn(partial, key)) continue;
      const value = partial[key];
      if (
        typeof value !== "string" ||
        value.length > maximumLength ||
        (key !== "announcementText" && value.trim().length === 0)
      ) {
        res.status(400).json({ error: `Invalid value for ${key}.` });
        return;
      }
      sanitized[key] = value;
    }

    await db.collection("settings").doc("global").set({
      ...sanitized,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.user?.uid ?? "admin",
    }, { merge: true });
    res.json({ saved: true });
  } catch (error) {
    console.error("[Settings] Failed to save settings:", error);
    res.status(500).json({ error: "Unable to save settings." });
  }
};

// The legacy PUT has always applied a partial update. Both paths share validation and persistence.
router.put("/", requireAdmin, updateSettings);
settingsV2Router.patch("/", requireAdmin, updateSettings);

export default router;
