import React, { useState, useEffect } from "react";
import { ChevronUp, ChevronDown, Navigation, Footprints } from "lucide-react";
import { RouteData } from "@/hooks/useRoutes";

interface RouteTimelineSheetProps {
  route: RouteData | null;
  targetStopId: string;
  activeBusId?: string | null;
  stopETAs?: Record<string, number>;
  headerContent?: React.ReactNode;
  bottomControls?: React.ReactNode;
  /** Walking ETA in minutes to the targetStop (from passenger's current location) */
  walkMinutesToTarget?: number;
}

export default function RouteTimelineSheet({
  route,
  targetStopId,
  activeBusId,
  stopETAs = {},
  headerContent,
  bottomControls,
  walkMinutesToTarget,
}: RouteTimelineSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !route || !route.stops || route.stops.length === 0) return null;

  const targetIndex = route.stops.findIndex((s) => s.id === targetStopId);
  const routeColor = route.color || "#3b82f6";

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-[64px] z-50 bg-brand-dark border-t border-white/10 rounded-t-3xl shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? "translate-y-0" : "translate-y-[calc(100%-64px)]"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Drag Handle / Header — tap to expand */}
        <div
          className="w-full h-[60px] flex items-center justify-between px-6 cursor-pointer relative"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/20 rounded-full" />
          {headerContent || (
            <div className="flex items-center w-full justify-between mt-2">
              <div className="flex items-center gap-3">
                <Navigation className="w-4 h-4 text-white/50" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/70">
                  Route Timeline
                </span>
              </div>
              <div className="text-white/40">
                {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </div>
            </div>
          )}
        </div>

        {/* Content (Scrollable list of stops) */}
        <div className="px-6 pb-4 pt-2 h-[50vh] max-h-[400px] overflow-y-auto">
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-[0.1em] mb-4 text-center">
            {route.name}
          </div>

          <div className="relative pl-6">
            {route.stops.map((stop, index) => {
              const isTarget = stop.id === targetStopId;
              const hasEtaData = Object.keys(stopETAs).length > 0;
              const etaMinutes = stopETAs[stop.id];
              const isPastBus = hasEtaData && etaMinutes === undefined;
              const isPastTarget = targetIndex !== -1 && index > targetIndex;
              const isDimmed = isPastBus || isPastTarget;
              const isLast = index === route.stops.length - 1;
              const isFirst = index === 0;

              return (
                <div key={stop.id} className={`relative flex items-start gap-4 pb-6 ${isDimmed ? "opacity-40" : "opacity-100"}`}>
                  {/* Timeline track / dots */}
                  <div className="absolute left-[-24px] top-0 bottom-0 flex flex-col items-center">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-[3px] border-brand-dark z-10 ${
                        isTarget ? "bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.6)]" : "bg-white/30"
                      }`}
                      style={{
                        background: isTarget ? "#f97316" : (isDimmed ? "rgba(255,255,255,0.1)" : routeColor)
                      }}
                    />
                    {!isLast && (
                      <div className="w-0.5 flex-1 mt-1 mb-1 opacity-20" style={{ background: routeColor }} />
                    )}
                  </div>

                  {/* Stop Details */}
                  <div className="flex-1 -mt-1.5 min-w-0">
                    <p className={`text-sm truncate ${isTarget ? "font-black text-white" : "font-bold text-white/80"}`}>
                      {stop.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] font-black tracking-widest text-white/40 uppercase">
                        {stop.shortName}
                      </span>
                      {isTarget && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-orange-500/20 text-orange-400">
                          Alight Here
                        </span>
                      )}
                      {isFirst && !isTarget && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-white/10 text-white/40">
                          Start
                        </span>
                      )}
                      {isLast && !isTarget && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-white/10 text-white/40">
                          Terminus
                        </span>
                      )}
                      {/* Walk-to-stop ETA only on the passenger's chosen stop */}
                      {isTarget && typeof walkMinutesToTarget === "number" && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-500/20 text-blue-400">
                          <Footprints className="w-2.5 h-2.5" />
                          {walkMinutesToTarget === 0 ? "At stop" : `Walk ${walkMinutesToTarget} min`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ETA Display (Right) */}
                  {typeof etaMinutes === "number" && !isPastBus && (
                    <div className="ml-auto text-right flex flex-col justify-center animate-fade-in pr-2">
                      <div className="flex items-baseline gap-1">
                        <span className={`text-lg font-black tracking-tighter ${etaMinutes <= 2 && etaMinutes > 0 ? "text-emerald-400" : "text-white"}`}>
                          {etaMinutes === 0 ? "Due" : etaMinutes}
                        </span>
                        {etaMinutes > 0 && <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">MIN</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Controls (driver delay buttons etc.) */}
        {bottomControls && (
          <div className="border-t border-white/10 px-4 py-3">
            {bottomControls}
          </div>
        )}
      </div>
    </>
  );
}
