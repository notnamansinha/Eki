"use client";

import { useState } from "react";
import { MessageCircle, Play, RefreshCw, TicketCheck } from "lucide-react";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { errorMessage } from "@/lib/errors";
import { useActiveBuses, type ActiveBusEntry } from "@/hooks/useActiveBuses";
import { useAuth } from "@/hooks/useAuth";
import { useBuses } from "@/hooks/useBuses";
import { useDrivers } from "@/hooks/useDrivers";
import { useRoutes } from "@/hooks/useRoutes";
import CustomSelect from "@/components/ui/CustomSelect";
import MessagingPanel from "@/components/shared/MessagingPanel";

async function adminRequest<T>(path: string, init: RequestInit): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Administrator session is unavailable.");
  const token = await currentUser.getIdToken();
  return apiRequest<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    fallbackError: "Ride operation failed.",
  });
}

function assignedRouteIds(bus: { assignedRoutes?: string[]; assignedRouteId?: string } | undefined) {
  return bus?.assignedRoutes ?? (bus?.assignedRouteId ? [bus.assignedRouteId] : []);
}

export default function OperationsPanel() {
  const { user } = useAuth();
  const { buses } = useBuses();
  const { drivers } = useDrivers();
  const { routes } = useRoutes();
  const activeEntries = useActiveBuses();
  const [driverId, setDriverId] = useState("");
  const [busId, setBusId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [delayPending, setDelayPending] = useState("");
  const [boardingCodes, setBoardingCodes] = useState<Record<string, string>>({});
  const [chatEntry, setChatEntry] = useState<ActiveBusEntry | null>(null);

  const selectedBus = buses.find((bus) => bus.id === busId);
  const allowedRouteIds = assignedRouteIds(selectedBus);
  const allowedRoutes = routes.filter((route) => allowedRouteIds.includes(route.id));

  const selectDriver = (nextDriverId: string) => {
    const driver = drivers.find((candidate) => candidate.id === nextDriverId);
    const nextBusId = driver?.assignedBusId ?? "";
    setDriverId(nextDriverId);
    setBusId(nextBusId);
    const nextBus = buses.find((bus) => bus.id === nextBusId);
    const nextRoutes = assignedRouteIds(nextBus);
    setRouteId(nextRoutes.length === 1 ? nextRoutes[0] : "");
    setStatus("");
  };

  const startRide = async () => {
    if (!driverId || !busId || !routeId) return;
    setPending(true);
    setStatus("");
    try {
      const result = await adminRequest<{ sessionId?: string; resumed?: boolean }>(
        "/api/shifts/start",
        {
          method: "POST",
          body: JSON.stringify({ driverId, busId, routeId }),
        },
      );
      setStatus(
        result.resumed
          ? `Active ride restored (${result.sessionId}).`
          : `Ride armed (${result.sessionId}). It starts automatically at stop 1.`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const changeDelay = async (entry: ActiveBusEntry, delta: number) => {
    if (!entry.routeId || !entry.driverId) return;
    const operationId = `${entry.busId}_${entry.routeId}`;
    const delayMinutes = Math.max(0, Number(entry.delayMinutes ?? 0) + delta);
    setDelayPending(operationId);
    setStatus("");
    try {
      await adminRequest<{ delayMinutes: number }>("/api/shifts/delay", {
        method: "PATCH",
        body: JSON.stringify({
          busId: entry.busId,
          routeId: entry.routeId,
          driverId: entry.driverId,
          delayMinutes,
        }),
      });
      setStatus(`Delay updated to ${delayMinutes} minutes for ${entry.busId}.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setDelayPending("");
    }
  };

  const loadBoardingCode = async (entry: ActiveBusEntry) => {
    if (!entry.sessionId) return;
    const sessionId = entry.sessionId;
    setStatus("");
    try {
      const result = await adminRequest<{ boardingCode?: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/boarding-code`,
        { method: "POST" },
      );
      if (!result.boardingCode) throw new Error("Boarding code was not returned.");
      const boardingCode = result.boardingCode;
      setBoardingCodes((current) => ({
        ...current,
        [sessionId]: boardingCode,
      }));
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-white">Ride operations</h1>
          <p className="mt-1 text-sm text-white/50">
            Administrators arm assigned vehicles; GNSS telemetry controls departure, stop progress, and completion.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <CustomSelect
            ariaLabel="Operator"
            value={driverId}
            onChange={selectDriver}
            options={[
              { value: "", label: "Select operator…" },
              ...drivers.map((driver) => ({ value: driver.id, label: `${driver.name} (${driver.id})` })),
            ]}
            placeholder="Select operator…"
          />
          <CustomSelect
            ariaLabel="Assigned vehicle"
            value={busId}
            onChange={() => undefined}
            disabled
            options={[
              { value: "", label: "No assigned vehicle" },
              ...buses.map((bus) => ({ value: bus.id, label: `${bus.name} (${bus.id})` })),
            ]}
            placeholder="Assigned vehicle"
          />
          <CustomSelect
            ariaLabel="Route"
            value={routeId}
            onChange={setRouteId}
            disabled={!busId}
            options={[
              { value: "", label: "Select route…" },
              ...allowedRoutes.map((route) => ({ value: route.id, label: route.name })),
            ]}
            placeholder="Select route…"
          />
        </div>

        <button
          type="button"
          onClick={() => void startRide()}
          disabled={pending || !driverId || !busId || !routeId}
          className="mt-5 flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
          Arm ride
        </button>
      </section>

      {status && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70" role="status">
          {status}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-black uppercase tracking-widest text-white/40">Active rides</h2>
        {activeEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/35">
            No active rides.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeEntries.map((entry) => {
              const operationId = `${entry.busId}_${entry.routeId ?? "route"}`;
              const code = entry.sessionId ? boardingCodes[entry.sessionId] : "";
              return (
                <article key={operationId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-white">{entry.busId}</h3>
                      <p className="text-xs text-white/40">{entry.routeId ?? "No route"} · {entry.tripState ?? "pre_departure"}</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-400">
                      {entry.deviceState === "offline" ? "Offline" : "Live"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-semibold text-white/50">Delay: {Math.max(0, Number(entry.delayMinutes ?? 0))} min</span>
                    {[-2, -1, 1, 2].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        disabled={delayPending === operationId || !entry.routeId || !entry.driverId}
                        onClick={() => void changeDelay(entry, delta)}
                        className="h-9 min-w-9 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-bold text-white disabled:opacity-40"
                        aria-label={`${delta > 0 ? "Increase" : "Decrease"} delay by ${Math.abs(delta)} minutes for ${entry.busId}`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!entry.sessionId}
                      onClick={() => void loadBoardingCode(entry)}
                      className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <TicketCheck className="size-4" />
                      {code ? `${code.slice(0, 4)}-${code.slice(4)}` : "Boarding code"}
                    </button>
                    <button
                      type="button"
                      disabled={!entry.sessionId || !user?.uid}
                      onClick={() => setChatEntry(entry)}
                      className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <MessageCircle className="size-4" /> Live chat
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {chatEntry?.sessionId && user?.uid && (
        <div className="fixed inset-0 z-[250] bg-black/70 pt-10 sm:p-10">
          <div className="mx-auto h-full max-w-2xl">
            <MessagingPanel
              sessionId={chatEntry.sessionId}
              currentUserRole="admin"
              currentUserId={user.uid}
              isOverlay
              onClose={() => setChatEntry(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
