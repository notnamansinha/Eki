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
  Search,
  Loader2,
  Eye,
  Bus as BusIcon,
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
          aria-hidden="true"
          className={`size-3.5 ${
            s <= rating
              ? "fill-ui-warning text-ui-warning"
              : "fill-transparent text-ui-quiet"
          }`}
        />
      ))}
      <span className="text-xs font-bold text-ui-warning ml-1 tabular-nums">{rating}/5</span>
    </div>
  );
}

/* Same tinted pills and soft leading tiles as the Fleet, History and Live Ops rows. */
const STATUS_STYLE: Record<FeedbackEntry["status"], { pill: string; tile: string; icon: string }> = {
  new: { pill: "bg-brand-accent/10 text-brand-accent", tile: "bg-brand-accent/10", icon: "text-brand-accent" },
  reviewed: { pill: "bg-ui-warning/15 text-ui-warning", tile: "bg-ui-warning/15", icon: "text-ui-warning" },
  resolved: { pill: "bg-ui-success/15 text-ui-success", tile: "bg-ui-success/15", icon: "text-ui-success" },
};

function StatusBadge({ status }: { status: FeedbackEntry["status"] }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${STATUS_STYLE[status].pill}`}>
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
  const submittedAt = entry.timestamp ? new Date(entry.timestamp.seconds * 1000) : null;
  const formattedTime = submittedAt
    ? submittedAt.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";
  const style = STATUS_STYLE[entry.status];
  const TypeIcon = entry.type === "ride" ? BusIcon : MessageSquare;

  return (
    <article
      data-status={entry.status}
      className={`overflow-hidden rounded-2xl border bg-ui-paper ${
        entry.status === "new" ? "border-brand-accent/40" : "border-ui-line"
      }`}
    >
      {/* Card header: the whole row toggles, as in History and Fleet. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`feedback-details-${entry.id}`}
        className="flex w-full cursor-pointer select-none items-start gap-3 p-4 text-left transition-colors hover:bg-ui-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent"
        onClick={() => setExpanded((o) => !o)}
      >
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${style.tile}`} aria-hidden="true">
          <TypeIcon className={`size-4 ${style.icon}`} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-ui-ink">{identity.passengerName}</span>
            <StatusBadge status={entry.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ui-muted">
            <StarDisplay rating={entry.rating} />
            <span>{entry.type === "ride" ? "Ride feedback" : "General feedback"}</span>
            <time dateTime={submittedAt?.toISOString()} className="tabular-nums">{formattedTime}</time>
            {entry.type === "ride" && (
              <span>{identity.busName || "Vehicle unavailable"}{identity.driverName ? ` · ${identity.driverName}` : ""}</span>
            )}
          </div>
          {entry.comment && <p className="mt-2 line-clamp-2 text-sm text-ui-ink [overflow-wrap:anywhere]">{entry.comment}</p>}
        </div>

        <span className="mt-1 shrink-0 text-ui-quiet" aria-hidden="true">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* Expanded body: tinted like History, details in Live Ops-style tiles. */}
      {expanded && (
        <div id={`feedback-details-${entry.id}`} className="flex flex-col gap-4 border-t border-ui-line bg-ui-soft p-4 animate-slide-up">
          {entry.comment ? (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-ui-quiet">Comment</p>
              <p className="text-sm text-ui-ink leading-relaxed [overflow-wrap:anywhere]">{entry.comment}</p>
            </div>
          ) : (
            <p className="text-xs text-ui-quiet italic">No comment provided.</p>
          )}

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                className="min-w-0 rounded-xl border border-ui-line bg-ui-paper p-3"
              >
                <dt className="text-xs font-bold uppercase tracking-widest text-ui-quiet">{label}</dt>
                <dd className="mt-1 truncate text-sm font-semibold text-ui-ink" title={value}>
                  {value}
                </dd>
                <p className="mt-0.5 text-xs text-ui-quiet truncate" title={reference}>
                  {reference}
                </p>
              </div>
            ))}
          </dl>

          {/* Status actions: secondary and primary admin buttons. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ui-quiet font-bold uppercase tracking-widest mr-1">
              Mark as
            </span>
            {(["reviewed", "resolved"] as FeedbackEntry["status"][]).map((s) => {
              const ActionIcon = s === "resolved" ? CheckCircle : Eye;
              return (
                <button
                  key={s}
                  type="button"
                  // The name stays the lowercase status whatever the visual casing.
                  aria-label={s}
                  onClick={() => void onStatusChange(entry.id, s)}
                  disabled={entry.status === s || updating}
                  className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    s === "resolved"
                      ? "bg-brand-accent text-ui-on-accent hover:enabled:bg-ui-accent-hover"
                      : "border border-ui-line bg-ui-paper text-ui-muted hover:enabled:bg-ui-hover"
                  }`}
                >
                  <ActionIcon className="size-4" aria-hidden="true" />
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </article>
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

  const Root = embedded ? "div" : "main";

  return (
    // Embedded in the admin page, which already owns the <main> landmark.
    <Root className={embedded ? "w-full text-ui-ink flex flex-col font-sans" : "min-h-screen bg-brand-dark text-ui-ink flex flex-col font-sans"}>
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

      <div className={embedded ? "w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-4 animate-slide-up" : "max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-4"}>
        {embedded && (
          <div>
            <h2 className="font-bold text-xl text-ui-ink">Feedback</h2>
            <p className="text-xs text-ui-quiet mt-0.5">Passenger ratings and comments</p>
          </div>
        )}
        {statusError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-ui-danger/30 bg-ui-danger/10 px-3 py-2 text-xs font-semibold text-ui-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{statusError}</span>
          </div>
        )}
        {loadError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-ui-danger/20 bg-ui-danger/5 px-4 py-16 text-center text-ui-danger" role="alert">
            <AlertCircle className="size-8 mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold">
              Couldn&apos;t load feedback
            </p>
            <p className="text-xs mt-1">{loadError}</p>
            <button
              type="button"
              onClick={retryFeedback}
              className="mt-4 min-h-11 rounded-lg bg-ui-hover px-4 py-2 text-xs font-semibold text-ui-ink"
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
              color: "text-ui-warning",
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
              <span className={`text-2xl font-bold tracking-tight tabular-nums ${color}`}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-quiet pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search feedback"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, bus, driver, or route…"
              className="w-full h-11 bg-ui-paper border border-ui-line rounded-xl pl-10 pr-4 text-sm text-ui-ink transition-colors placeholder:text-ui-quiet font-medium"
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
              className="h-11 rounded-xl border border-ui-line bg-ui-soft px-4 text-xs font-bold uppercase tracking-widest text-ui-muted transition-colors hover:bg-ui-hover"
            >
              Reset
            </button>
          )}
        </div>

        {/* Results count: label and count pill, as in Fleet. */}
        <div className="flex items-center gap-2 text-xs text-ui-quiet font-bold uppercase tracking-widest">
          <span>Entries</span>
          <span className="rounded-full bg-ui-hover px-2 py-0.5 text-ui-muted tabular-nums">
            {loading ? "…" : `${filtered.length} of ${total}`}
          </span>
        </div>

        {/* Feedback list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-ui-quiet">
            <Loader2 className="size-6 animate-spin text-brand-accent" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Loading feedback…
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-16 text-ui-quiet text-center">
            <Inbox className="size-8 mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold">
              No feedback found
            </p>
            <p className="text-xs">
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
    </Root>
  );
}
