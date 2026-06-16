"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  doc,
  updateDoc,
} from "firebase/firestore";
import {
  Star,
  MessageSquare,
  Bus,
  User,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Inbox,
  Filter,
  Route,
} from "lucide-react";

interface FeedbackEntry {
  id: string;
  userId: string;
  userName: string;
  type: "ride" | "general";
  busId: string | null;
  driverId: string | null;
  routeId?: string | null;
  rating: number | null;
  comment: string;
  timestamp: Timestamp | null;
  status: "new" | "reviewed" | "resolved";
}

function StarDisplay({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-white/20 text-xs font-bold">No rating</span>;
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
  onStatusChange,
}: {
  entry: FeedbackEntry;
  onStatusChange: (id: string, status: FeedbackEntry["status"]) => void;
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
      className={`group bg-white/3 border rounded-2xl overflow-hidden transition-all duration-300 hover:bg-white/5 ${
        entry.status === "new"
          ? "border-blue-500/20"
          : entry.status === "resolved"
          ? "border-white/5"
          : "border-amber-500/20"
      }`}
    >
      {/* Card Header */}
      <div
        className="p-4 flex items-start gap-4 cursor-pointer select-none"
        onClick={() => setExpanded((o) => !o)}
      >
        {/* Rating circle / type icon */}
        <div
          className={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center text-xl font-black shadow-lg ${
            entry.type === "ride"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-emerald-500/20 text-emerald-400"
          }`}
        >
          {entry.type === "ride" ? (
            <Bus className="w-5 h-5" />
          ) : (
            <MessageSquare className="w-5 h-5" />
          )}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-bold text-white text-sm truncate">{entry.userName}</span>
            <StatusBadge status={entry.status} />
            <span
              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                entry.type === "ride"
                  ? "bg-blue-500/10 text-blue-400/70 border-blue-500/20"
                  : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20"
              }`}
            >
              {entry.type}
            </span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-white/30 font-bold uppercase tracking-widest">
            {entry.busId && (
              <span className="flex items-center gap-1">
                <Bus className="w-3 h-3" /> {entry.busId}
              </span>
            )}
            {entry.driverId && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" /> {entry.driverId.slice(0, 12)}…
              </span>
            )}
            {entry.routeId && (
              <span className="flex items-center gap-1">
                <Route className="w-3 h-3" /> {entry.routeId}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formattedTime}
            </span>
          </div>

          {/* Star rating */}
          <div className="mt-2">
            <StarDisplay rating={entry.rating} />
          </div>
        </div>

        {/* Expand chevron */}
        <div className="text-white/20 group-hover:text-white/50 transition-colors shrink-0 mt-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 flex flex-col gap-4 animate-slide-up">
          {/* Comment */}
          {entry.comment ? (
            <div className="bg-black/20 rounded-xl p-4 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">
                Feedback Comment
              </p>
              <p className="text-sm text-white/80 leading-relaxed">{entry.comment}</p>
            </div>
          ) : (
            <p className="text-[11px] text-white/20 italic">No comment provided.</p>
          )}

          {/* Full details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "User ID", value: entry.userId, icon: User },
              { label: "Bus ID", value: entry.busId || "—", icon: Bus },
              { label: "Driver ID", value: entry.driverId || "—", icon: User },
              { label: "Route", value: entry.routeId || "—", icon: Route },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="bg-white/3 rounded-xl p-3 border border-white/5"
              >
                <div className="flex items-center gap-1.5 mb-1 text-white/30">
                  <Icon className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
                </div>
                <p className="text-xs font-bold text-white/70 truncate" title={value ?? undefined}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Status action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-white/20 font-black uppercase tracking-widest mr-1">
              Mark as:
            </span>
            {(["new", "reviewed", "resolved"] as FeedbackEntry["status"][]).map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(entry.id, s)}
                disabled={entry.status === s}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
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

export default function FeedbackPage() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = query(collection(db, "feedback"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeedbackEntry))
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleStatusChange = async (
    id: string,
    status: FeedbackEntry["status"]
  ) => {
    try {
      await updateDoc(doc(db, "feedback", id), { status });
    } catch (e) {
      console.error("Status update failed:", e);
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
        e.comment?.toLowerCase().includes(q) ||
        e.routeId?.toLowerCase().includes(q)
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
    <main className="min-h-screen bg-brand-dark text-white flex flex-col font-sans">
      {/* Header */}
      <header className="sticky top-0 z-[100] w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-white/50" />
          </div>
          <div className="flex flex-col">
            <span
              className="font-black text-sm uppercase tracking-[0.18em] text-white leading-none"
              style={{ fontFamily: "Outfit" }}
            >
              Feedback Console
            </span>
            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
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
      </header>

      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
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
              className="w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-white/20 font-bold"
            />
          </div>
          <div className="flex gap-2">
            {(["all", "ride", "general"] as FilterType[]).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                  filterType === t
                    ? "bg-white text-brand-dark border-white"
                    : "bg-white/5 text-white/40 border-white/10 hover:border-white/20 hover:text-white/70"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["all", "new", "reviewed", "resolved"] as FilterStatus[]).map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                    filterStatus === s
                      ? "bg-white text-brand-dark border-white"
                      : "bg-white/5 text-white/40 border-white/10 hover:border-white/20 hover:text-white/70"
                  }`}
                >
                  {s}
                </button>
              )
            )}
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center gap-2 text-[10px] text-white/30 font-black uppercase tracking-widest -mb-2">
          <CheckCircle className="w-3.5 h-3.5" />
          {loading ? "Loading…" : `${filtered.length} of ${total} entries`}
        </div>

        {/* Feedback list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/20">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mb-4" />
            <span className="text-[11px] font-bold uppercase tracking-widest">
              Loading feedback…
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/20 text-center">
            <Inbox className="w-10 h-10 mb-4 opacity-30" />
            <p className="text-sm font-bold uppercase tracking-widest">
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
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
