"use client";

import PassengerMap from "@/components/maps/PassengerMap";
import { BRTS_ROUTES } from "@/config/brtsRoutes";

export default function SimulatePassengerPage() {
  return (
    <div className="flex flex-col h-screen bg-brand-dark text-white overflow-hidden">
      <div className="bg-brand-dark/90 backdrop-blur border-b border-white/10 px-4 py-3 shrink-0 flex items-center justify-between z-50">
        <h1 className="font-bold text-lg text-white">Simulation: Passenger Node</h1>
        <span className="text-xs bg-emerald-500/20 text-emerald-300 font-bold px-2 py-1 rounded">Testing Mode</span>
      </div>
      
      <div className="relative flex-1">
        <PassengerMap 
          targetStop={BRTS_ROUTES[0].stops[1]} 
          route={BRTS_ROUTES[0] as any} 
        />
      </div>
    </div>
  );
}
