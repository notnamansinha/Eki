"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { useBuses } from "@/hooks/useBuses";
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

interface FeedbackEntry {
  id: string;
  userId: string;
  userName: string;
  type: "ride" | "general";
  busId: string | null;
  driverId: string | null;
  sessionId?: string | null;
  rating: number | null;
  comment: string;
  timestamp: { seconds: number; nanoseconds: number } | null;
  status: "new" | "reviewed" | "resolved";
}

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
  if (!rating) return <span className="text-white/20 text-xs font-semibold">No rating</span>;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${
            s <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-transparent text-white/10"
          }`}
        />
      ))}
      <span className="text-xs font-black text-yellow-400 ml-1">{rating}/5</span>
    </div>
  );
}

function StatusBadge({ status }: { status: FeedbackEntry["status"] }) {
  const cfg = {
    new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    reviewed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    resolved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  }[status];
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${cfg}`}>
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
      className={`border-b border-white/10 ${
        entry.status === "new"
          ? "bg-blue-500/[0.04]"
          : entry.status === "resolved"
          ? "bg-transparent"
          : "bg-amber-500/[0.03]"
      }`}
    >
      {/* Card Header */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`feedback-details-${entry.id}`}
        className="flex min-h-20 w-full cursor-pointer select-none items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50"
        onClick={() => setExpanded((o) => !o)}
      >
        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-semibold text-white text-sm truncate">{identity.passengerName}</span>
            <StatusBadge status={entry.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
            <StarDisplay rating={entry.rating} />
            <span>{entry.type === "ride" ? "Ride feedback" : "General feedback"}</span>
            <span>{formattedTime}</span>
            {entry.type === "ride" && (
              <span>{identity.busName || "Vehicle unavailable"}{identity.driverName ? ` · ${identity.driverName}` : ""}</span>
            )}
          </div>
          {entry.comment && <p className="mt-2 truncate text-xs text-white/55">{entry.comment}</p>}
        </div>

        {/* Expand chevron */}
        <div className="mt-1 shrink-0 text-white/50">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div id={`feedback-details-${entry.id}`} className="px-4 pb-4 border-t border-white/5 pt-4 flex flex-col gap-4 animate-slide-up">
          {/* Comment */}
          {entry.comment ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-white/45">Comment</p>
              <p className="text-sm text-white/80 leading-relaxed">{entry.comment}</p>
            </div>
          ) : (
            <p className="text-[11px] text-white/20 italic">No comment provided.</p>
          )}

          {/* Full details grid */}
          <dl className="grid grid-cols-1 gap-x-5 gap-y-3 border-y border-white/5 py-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <dt className="text-xs font-medium text-white/40">{label}</dt>
                <dd className="mt-1 truncate text-xs font-semibold text-white/80" title={value}>
                  {value}
                </dd>
                <p className="mt-1 text-[9px] font-medium text-white/35 truncate" title={reference}>
                  {reference}
                </p>
              </div>
            ))}
          </dl>

          {/* Status action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-white/20 font-black uppercase tracking-widest mr-1">
              Mark as:
            </span>
            {(["new", "reviewed", "resolved"] as FeedbackEntry["status"][]).map((s) => (
              <button
                key={s}
                onClick={() => void onStatusChange(entry.id, s)}
                disabled={entry.status === s || updating}
                className={`min-h-11 px-3 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  s === "resolved"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30"
                    : s === "reviewed"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30"
                    : "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
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

export default function FeedbackPage({ embedded = false }: { embedded?: boolean }) {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const { buses } = useBuses();
  const { drivers } = useDrivers();
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Feedback admin service is unavailable.");
        const result = await apiRequest<{ feedbacks: FeedbackEntry[] }>("/api/v2/feedback", {
          headers: { Authorization: `Bearer ${token}` },
          fallbackError: "Permission denied reading feedbacks.",
        });
        if (active) setEntries(Array.isArray(result.feedbacks) ? result.feedbacks : []);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : "Unable to load feedback.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [retryGeneration]);

  const retryFeedback = () => setRetryGeneration((generation) => generation + 1);

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
    if (updatingId) return;
    setUpdatingId(id);
    setStatusError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Feedback admin service is unavailable.");
      await apiRequest(`/api/v2/feedback/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
        fallbackError: "Unable to update feedback status.",
      });
      setEntries((current) => current.map((entry) =>
        entry.id === id ? { ...entry, status } : entry,
      ));
    } catch (e) {
      console.error("Status update failed:", e);
      setStatusError(e instanceof Error ? e.message : "Unable to update feedback status.");
    } finally {
      setUpdatingId(null);
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
    <main className={embedded ? "w-full bg-brand-dark text-white flex flex-col font-sans" : "min-h-screen bg-brand-dark text-white flex flex-col font-sans"}>
      {/* Header */}
      {!embedded && <header className="sticky top-0 z-[100] w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-white/50" />
          </div>
          <div className="flex flex-col">
            <span
              className="font-black text-sm uppercase tracking-[0.18em] text-white leading-none"
             
            >
              Feedback Console
            </span>
            <span className="text-[9px] text-white/30 font-semibold uppercase tracking-widest">
              Admin Only
            </span>
          </div>
          <a
            href="/admin"
            className="ml-auto text-[10px] text-white/30 hover:text-white font-black uppercase tracking-widest transition-colors"
          >
            ← Admin Panel
          </a>
        </div>
      </header>}

      <div className={embedded ? "w-full px-4 sm:px-6 py-6 flex flex-col gap-6" : "max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6"}>
        {statusError && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {statusError}
          </div>
        )}
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-red-400/80 text-center" role="alert">
            <AlertCircle className="w-10 h-10 mb-4 opacity-60" />
            <p className="text-sm font-semibold uppercase tracking-widest">
              Couldn&apos;t load feedback
            </p>
            <p className="text-xs mt-1 opacity-70">{loadError}</p>
            <button
              type="button"
              onClick={retryFeedback}
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: total, icon: Inbox, color: "text-white" },
            {
              label: "Unreviewed",
              value: newCount,
              icon: MessageSquare,
              color: "text-blue-400",
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
              className="bg-white/3 border border-white/5 rounded-2xl p-4 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 text-white/30">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {label}
                </span>
              </div>
              <span className={`text-2xl font-black tracking-tight ${color}`}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, bus, driver, or route…"
              className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20 font-semibold"
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
              className="h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-semibold text-white/70"
            >
              Reset
            </button>
          )}
        </div>

        {/* Results count */}
        <div className="flex items-center gap-2 text-[10px] text-white/30 font-black uppercase tracking-widest -mb-2">
          <CheckCircle className="w-3.5 h-3.5" />
          {loading ? "Loading…" : loadError ? "Couldn't load" : `${filtered.length} of ${total} entries`}
        </div>

        {/* Feedback list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/20">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mb-4" />
            <span className="text-[11px] font-semibold uppercase tracking-widest">
              Loading feedback…
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/20 text-center">
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
