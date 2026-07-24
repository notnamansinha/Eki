"use client";

import { useCollection } from "@/hooks/useCollection";
import { Loader2, MapPin, Bus, User, Users } from "lucide-react";
import { useState } from "react";

interface PassengerRecord {
  userId: string;
  userName: string;
  boardingStopId: string;
  alightingStopId: string | null;
  joinedAt: number;
}

interface RideSession {
  id: string;
  busId: string;
  driverId: string;
  routeId: string;
  startTime: number;
  endTime?: number;
  status: "active" | "completed";
  passengers?: PassengerRecord[] | Record<string, PassengerRecord>;
  path?: { lat: number; lng: number; timestamp: number }[];
  stopsReached?: { stopIndex: number; stopId: string; stopName: string; timestamp: number }[];
}

function passengerRecords(passengers: RideSession["passengers"]): PassengerRecord[] {
  if (!passengers) return [];
  return Array.isArray(passengers) ? passengers : Object.values(passengers);
}

export default function RideHistoryPanel() {
  const { data: sessions, loading } = useCollection<RideSession>("ride_sessions");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-brand-accent" />
      </div>
    );
  }

  const sortedSessions = [...sessions].sort((a, b) => b.startTime - a.startTime);

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4 animate-slide-up">
      <h2 className="text-xl font-bold text-white mb-4">Ride History</h2>
      {sortedSessions.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-10">No rides recorded yet.</div>
      ) : (
        sortedSessions.map(session => {
          const passengers = passengerRecords(session.passengers);

          return (
          <div key={session.id} className="bg-brand-surface border border-white/10 rounded-xl overflow-hidden transition-all">
            <button
              type="button"
              className="w-full text-left p-4 cursor-pointer hover:bg-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
              aria-expanded={expandedId === session.id}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${session.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60'}`}>
                    {session.status}
                  </span>
                  <span className="text-sm font-semibold text-white/80">{new Date(session.startTime).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-white/60">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> Route {session.routeId}</span>
                  <span className="flex items-center gap-1"><Bus className="w-3 h-3"/> Bus {session.busId}</span>
                  <span className="flex items-center gap-1"><User className="w-3 h-3"/> Driver {session.driverId}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 bg-brand-dark/50 px-3 py-1.5 rounded-lg border border-white/5">
                  <Users className="w-4 h-4 text-brand-accent" />
                  <span className="text-sm font-bold text-white">{passengers.length}</span>
                </div>
              </div>
            </button>

            {expandedId === session.id && (
              <div className="px-4 pb-4 border-t border-white/10 bg-black/20 pt-4">
                <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Passenger Manifest</h4>
                {passengers.length === 0 ? (
                  <p className="text-xs text-white/30 italic">No passengers boarded.</p>
                ) : (
                  <div className="space-y-2">
                    {passengers.map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1.5 px-3 rounded bg-white/5 border border-white/5">
                        <span className="font-medium text-white/90">{p.userName} <span className="text-xs text-white/50 ml-1">({p.userId.substring(0,6)}...)</span></span>
                        <div className="text-xs text-white/60 flex items-center gap-2">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded">{p.boardingStopId}</span>
                          {p.alightingStopId && (
                            <>
                              <span className="text-white/30">&rarr;</span>
                              <span className="bg-white/10 px-1.5 py-0.5 rounded">{p.alightingStopId}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {session.stopsReached && session.stopsReached.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <MapPin className="w-3 h-3"/> 
                      Route Log ({session.path?.length || 0} GPS breadcrumbs saved)
                    </h4>
                    <div className="space-y-3 relative before:absolute before:inset-0 before:ml-[39px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                      {session.stopsReached.map((s, i) => (
                        <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full border border-white/20 bg-brand-dark text-white/50 group-[.is-active]:text-brand-accent shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ml-7 md:ml-0">
                            <div className="w-2 h-2 bg-brand-accent rounded-full"></div>
                          </div>
                          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-3 rounded bg-white/5 border border-white/10">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-white text-sm">{s.stopName}</span>
                              <span className="text-brand-accent font-mono text-xs">{new Date(s.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-xs text-white/50">Stop Index: {s.stopIndex}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })
      )}
    </div>
  );
}
