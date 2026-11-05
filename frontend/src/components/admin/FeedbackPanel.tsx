"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebaseAuth";
import { getAuthVerificationGeneration } from "@/lib/authState";
import { useBuses } from "@/hooks/useBuses";
import { useAuth } from "@/hooks/useAuth";
import { type FeedbackEntry } from "@/lib/feedback";
import { feedbackErrorMessage, loadFeedback, updateFeedbackStatus } from "@/lib/feedbackStore";
import { useDrivers } from "@/hooks/useDrivers";
import {
  Star,
  MessageSquare,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Inbox,
  Filter,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";

interface FeedbackIdentity {
  passengerName: string;
  busName: string | null;
  driverName: string | null;
}

function shortId(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function linkedDetail(
  id: string | null | undefined,
  label: string,
  resolvedName: string | null,
  type: FeedbackEntry["type"],
) {
  if (!id) {
    return {
      value: type === "general" ? "Not linked to a ride" : `${label} not recorded`,
      reference: type === "general" ? "General feedback" : "Incomplete ride context",
    };
  }
  return {
    value: resolvedName || `Unregistered ${label.toLowerCase()}`,
    reference: `${label} ID · ${shortId(id)}`,
  };
}

function StarDisplay({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-ui-quiet text-xs font-semibold">No rating</span>;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${
            s <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-transparent text-ui-quiet"
          }`}
        />
      ))}
      <span className="text-xs font-bold text-yellow-400 ml-1">{rating}/5</span>
    </div>
  );
}

function StatusBadge({ status }: { status: FeedbackEntry["status"] }) {
  const cfg = {
    new: "bg-brand-accent/20 text-brand-accent border-brand-accent/30",
    reviewed: "bg-ui-warning/20 text-ui-warning border-ui-warning/30",
    resolved: "bg-ui-success/20 text-ui-success border-ui-success/30",
  }[status];
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-bold uppercase tracking-widest ${cfg}`}>
      {status}
    </span>
  );
}

function FeedbackCard({
  entry,
  identity,
  onStatusChange,
  updating,
}: {
  entry: FeedbackEntry;
  identity: FeedbackIdentity;
  onStatusChange: (id: string, status: FeedbackEntry["status"]) => Promise<void>;
  updating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const formattedTime = entry.timestamp
    ? new Date(entry.timestamp.seconds * 1000).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

  return (
    <div
      className={`border-b border-ui-line ${
        entry.status === "new"
          ? "bg-brand-accent/[0.04]"
          : entry.status === "resolved"
          ? "bg-transparent"
          : "bg-ui-warning/[0.03]"
      }`}
    >
      {/* Card Header */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`feedback-details-${entry.id}`}
        className="flex min-h-20 w-full cursor-pointer select-none items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent"
        onClick={() => setExpanded((o) => !o)}
      >
        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-semibold text-ui-ink text-sm truncate">{identity.passengerName}</span>
            <StatusBadge status={entry.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ui-quiet">
            <StarDisplay rating={entry.rating} />
            <span>{entry.type === "ride" ? "Ride feedback" : "General feedback"}</span>
            <span>{formattedTime}</span>
            {entry.type === "ride" && (
              <span>{identity.busName || "Vehicle unavailable"}{identity.driverName ? ` · ${identity.driverName}` : ""}</span>
            )}
          </div>
          {entry.comment && <p className="mt-2 truncate text-xs text-ui-muted">{entry.comment}</p>}
        </div>

        {/* Expand chevron */}
        <div className="mt-1 shrink-0 text-ui-muted">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div id={`feedback-details-${entry.id}`} className="px-4 pb-4 border-t border-ui-line pt-4 flex flex-col gap-4 animate-slide-up">
          {/* Comment */}
          {entry.comment ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-ui-quiet">Comment</p>
              <p className="text-sm text-ui-ink leading-relaxed">{entry.comment}</p>
            </div>
          ) : (
            <p className="text-xs text-ui-quiet italic">No comment provided.</p>
          )}

          {/* Full details grid */}
          <dl className="grid grid-cols-1 gap-x-5 gap-y-3 border-y border-ui-line py-3 sm:grid-cols-2 lg:grid-cols-4">
            {(() => {
              const bus = linkedDetail(entry.busId, "Bus", identity.busName, entry.type);
              const driver = linkedDetail(entry.driverId, "Driver", identity.driverName, entry.type);
              const session = linkedDetail(
                entry.sessionId,
                "Session",
                shortId(entry.sessionId),
                entry.type,
              );
              return [
                {
                  label: "Passenger",
                  value: identity.passengerName,
                  reference: entry.userId ? `Account ID · ${shortId(entry.userId)}` : "Account ID unavailable",
                },
                { label: "Vehicle", ...bus },
                { label: "Driver", ...driver },
                { label: "Ride session", ...session },
              ];
            })().map(({ label, value, reference }) => (
              <div
                key={label}
                className="min-w-0"
              >
                <dt className="text-xs font-medium text-ui-quiet">{label}</dt>
                <dd className="mt-1 truncate text-xs font-semibold text-ui-ink" title={value}>
                  {value}
                </dd>
                <p className="mt-1 text-xs font-medium text-ui-quiet truncate" title={reference}>
                  {reference}
                </p>
              </div>
            ))}
          </dl>

          {/* Status action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-ui-quiet font-bold uppercase tracking-widest mr-1">
              Mark as:
            </span>
            {(["reviewed", "resolved"] as FeedbackEntry["status"][]).map((s) => (
              <button
                key={s}
                onClick={() => void onStatusChange(entry.id, s)}
                disabled={entry.status === s || updating}
                className={`min-h-11 px-3 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  s === "resolved"
                    ? "bg-ui-success/20 text-ui-success border-ui-success/30 hover:bg-ui-success/30"
                    : "bg-ui-warning/20 text-ui-warning border-ui-warning/30 hover:bg-ui-warning/30"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type FilterType = "all" | "ride" | "general";
type FilterStatus = "all" | "new" | "reviewed" | "resolved";
const EMPTY_FEEDBACK: FeedbackEntry[] = [];

export default function FeedbackPanel({ embedded = false }: { embedded?: boolean }) {
  const { user, loading: authLoading } = useAuth();
  const authGeneration = getAuthVerificationGeneration();
  const adminUid = user?.role === "admin" && !authLoading ? user.uid : null;
  const scope = adminUid ? `${adminUid}:${authGeneration}` : null;
  const pendingUpdate = useRef<{ scope: string } | null>(null);
  const [mutation, setMutation] = useState<{ scope: string; updatingId: string | null; error: string } | null>(null);
  const updatingId = scope && mutation?.scope === scope ? mutation.updatingId : null;
  const statusError = scope && mutation?.scope === scope ? mutation.error : "";
  const [list, setList] = useState<{
    scope: string | null; entries: FeedbackEntry[]; loading: boolean; error: string | null;
  }>({ scope: null, entries: [], loading: true, error: null });
  const [retryGeneration, setRetryGeneration] = useState(0);
  const entries = scope && list.scope === scope ? list.entries : EMPTY_FEEDBACK;
  const loading = authLoading || Boolean(scope && (list.scope !== scope || list.loading));
  const loadError = scope && list.scope === scope ? list.error : null;
  const retryFeedback = () => {
    setList({ scope, entries: [], loading: true, error: null });
    setRetryGeneration(value => value + 1);
  };

  useEffect(() => () => {
    if (pendingUpdate.current?.scope === scope) {
      pendingUpdate.current = null;
    }
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    void (async () => {
      try {
        const firebaseUser = auth.currentUser;
        if (firebaseUser?.uid !== adminUid || getAuthVerificationGeneration() !== authGeneration) throw new Error("Authentication changed. Try again.");
        const entries = await loadFeedback();
        if (active && getAuthVerificationGeneration() === authGeneration && auth.currentUser?.uid === adminUid) setList({ scope, entries, loading: false, error: null });
      } catch (error) {
        if (active && getAuthVerificationGeneration() === authGeneration && auth.currentUser?.uid === adminUid) setList({ scope, entries: [], loading: false,
          error: feedbackErrorMessage(error, "Unable to load feedback.") });
      }
    })();
    return () => { active = false; };
  }, [scope, adminUid, authGeneration, retryGeneration]);
  const { buses } = useBuses();
  const { drivers } = useDrivers();
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const identities = useMemo(() => {
    const busNames = new Map(
      buses
        .filter((bus) => Boolean(bus.name?.trim()))
        .map((bus) => [bus.id, bus.name.trim()]),
    );
    const driverNames = new Map<string, string>();
    for (const driver of drivers) {
      if (!driver.name?.trim()) continue;
      driverNames.set(driver.id, driver.name.trim());
      if (driver.authUid) driverNames.set(driver.authUid, driver.name.trim());
    }

    return new Map(entries.map((entry) => [
      entry.id,
      {
        passengerName: entry.userName?.trim() || "Unnamed passenger",
        busName: entry.busId ? busNames.get(entry.busId) || null : null,
        driverName: entry.driverId ? driverNames.get(entry.driverId) || null : null,
      },
    ]));
  }, [buses, drivers, entries]);

  const handleStatusChange = async (
    id: string,
    status: FeedbackEntry["status"]
  ) => {
    if (!scope || pendingUpdate.current?.scope === scope) return;
    const operation = { scope };
    pendingUpdate.current = operation;
    setMutation({ scope, updatingId: id, error: "" });
    const isCurrentSession = () => pendingUpdate.current === operation &&
      getAuthVerificationGeneration() === authGeneration && auth.currentUser?.uid === adminUid;
    try {
      if (!isCurrentSession()) throw new Error("Authentication changed. Try again.");
      await updateFeedbackStatus(adminUid!, id, status);
      if (!isCurrentSession()) return;
      setList(current => current.scope === scope ? {
        ...current, entries: current.entries.map(entry => entry.id === id ? { ...entry, status } : entry),
      } : current);
    } catch (e) {
      console.error("Status update failed:", e);
      if (isCurrentSession()) setMutation({ scope, updatingId: null, error: feedbackErrorMessage(e, "Unable to update feedback status.") });
    } finally {
      if (pendingUpdate.current === operation) {
        pendingUpdate.current = null;
        setMutation(current => current?.scope === scope ? { ...current, updatingId: null } : current);
      }
    }
  };

  const filtered = entries.filter((e) => {
    if (filterType !== "all" && e.type !== filterType) return false;
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.userName?.toLowerCase().includes(q) ||
        e.busId?.toLowerCase().includes(q) ||
        e.driverId?.toLowerCase().includes(q) ||
        identities.get(e.id)?.busName?.toLowerCase().includes(q) ||
        identities.get(e.id)?.driverName?.toLowerCase().includes(q) ||
        e.comment?.toLowerCase().includes(q) ||
        e.sessionId?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const total = entries.length;
  const newCount = entries.filter((e) => e.status === "new").length;
  const avgRating =
    entries.filter((e) => e.rating).length > 0
      ? (
          entries.reduce((acc, e) => acc + (e.rating || 0), 0) /
          entries.filter((e) => e.rating).length
        ).toFixed(1)
      : "—";

  return (
    <main className={embedded ? "w-full bg-brand-dark text-ui-ink flex flex-col font-sans" : "min-h-screen bg-brand-dark text-ui-ink flex flex-col font-sans"}>
      {/* Header */}
      {!embedded && <header className="sticky top-0 z-[100] w-full border-b border-ui-line bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-ui-hover flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-ui-muted" />
          </div>
          <div className="flex flex-col">
            <span
              className="font-bold text-sm uppercase tracking-[0.18em] text-ui-ink leading-none"

            >
              Feedback Console
            </span>
            <span className="text-xs text-ui-quiet font-semibold uppercase tracking-widest">
              Admin Only
            </span>
          </div>
          <a
            href="/admin"
            className="ml-auto text-xs text-ui-quiet hover:text-ui-ink font-bold uppercase tracking-widest transition-colors"
          >
            ← Admin Panel
          </a>
        </div>
      </header>}

      <div className={embedded ? "w-full px-4 sm:px-6 py-6 flex flex-col gap-6" : "max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6"}>
        {statusError && (
          <div role="alert" className="rounded-xl border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-sm text-ui-danger">
            {statusError}
          </div>
        )}
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-ui-danger text-center" role="alert">
            <AlertCircle className="w-10 h-10 mb-4 opacity-60" />
            <p className="text-sm font-semibold uppercase tracking-widest">
              Couldn&apos;t load feedback
            </p>
            <p className="text-xs mt-1 opacity-70">{loadError}</p>
            <button
              type="button"
              onClick={retryFeedback}
              className="mt-4 rounded-lg bg-ui-hover px-4 py-2 text-xs font-semibold text-ui-ink"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: total, icon: Inbox, color: "text-ui-ink" },
            {
              label: "Unreviewed",
              value: newCount,
              icon: MessageSquare,
              color: "text-brand-accent",
            },
            {
              label: "Avg Rating",
              value: avgRating,
              icon: Star,
              color: "text-yellow-400",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="bg-ui-paper border border-ui-line rounded-2xl p-4 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 text-ui-quiet">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-xs font-bold uppercase tracking-widest">
                  {label}
                </span>
              </div>
              <span className={`text-2xl font-bold tracking-tight ${color}`}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-quiet pointer-events-none" />
            <input
              type="text"
              aria-label="Search feedback"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, bus, driver, or route…"
              className="w-full h-11 bg-ui-soft border border-ui-line rounded-xl pl-9 pr-4 text-sm text-ui-ink focus:outline-none focus:border-ui-control transition-colors placeholder:text-ui-quiet font-semibold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-[300px]">
            <CustomSelect
              name="feedback-type"
              ariaLabel="Feedback type"
              value={filterType}
              onChange={(value) => setFilterType(value as FilterType)}
              options={[
                { value: "all", label: "All types" },
                { value: "ride", label: "Ride" },
                { value: "general", label: "General" },
              ]}
            />
            <CustomSelect
              name="feedback-status"
              ariaLabel="Feedback status"
              value={filterStatus}
              onChange={(value) => setFilterStatus(value as FilterStatus)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "new", label: "New" },
                { value: "reviewed", label: "Reviewed" },
                { value: "resolved", label: "Resolved" },
              ]}
            />
          </div>
          {(search || filterType !== "all" || filterStatus !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilterType("all");
                setFilterStatus("all");
              }}
              className="h-11 rounded-xl border border-ui-line bg-ui-soft px-4 text-xs font-semibold text-ui-muted"
            >
              Reset
            </button>
          )}
        </div>

        {/* Results count */}
        <div className="flex items-center gap-2 text-xs text-ui-quiet font-bold uppercase tracking-widest -mb-2">
          <CheckCircle className="w-3.5 h-3.5" />
          {loading ? "Loading…" : loadError ? "Couldn't load" : `${filtered.length} of ${total} entries`}
        </div>

        {/* Feedback list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-ui-quiet">
            <div className="w-8 h-8 border-2 border-ui-control border-t-ui-control rounded-full animate-spin mb-4" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Loading feedback…
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-ui-quiet text-center">
            <Inbox className="w-10 h-10 mb-4 opacity-30" />
            <p className="text-sm font-semibold uppercase tracking-widest">
              No feedback found
            </p>
            <p className="text-xs mt-1 opacity-60">
              Try adjusting your filters
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((entry) => (
              <FeedbackCard
                key={entry.id}
                entry={entry}
                identity={identities.get(entry.id) ?? {
                  passengerName: entry.userName?.trim() || "Unnamed passenger",
                  busName: null,
                  driverName: null,
                }}
                onStatusChange={handleStatusChange}
                updating={updatingId !== null}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </main>
  );
}
