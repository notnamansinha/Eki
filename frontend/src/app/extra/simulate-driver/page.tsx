"use client";

import { useState, useEffect, useRef } from "react";
import DriverMap from "@/components/maps/DriverMap";
import { BRTS_ROUTES } from "@/config/brtsRoutes";
import { useDriverSimulation } from "@/hooks/useDriverSimulation";

export default function SimulateDriverPage() {
  const [busId] = useState("BRTS-SIM-1");
  const socketRef = useRef<ReturnType<typeof import("socket.io-client").io> | null>(null);

  useEffect(() => {
    import("socket.io-client").then(({ io }) => {
      const socket = io(process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000", {
        transports: ["websocket"],
      });
      socketRef.current = socket;
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const sim = useDriverSimulation({
    route: BRTS_ROUTES[0],
    targetStop: BRTS_ROUTES[0].stops[1],
    socketRef: socketRef as any,
    busId: busId
  });

  return (
    <div className="flex flex-col h-screen bg-brand-dark text-white overflow-hidden">
      <div className="bg-brand-dark/90 backdrop-blur border-b border-white/10 px-4 py-3 shrink-0 flex items-center justify-between z-50">
        <h1 className="font-bold text-lg text-white">Simulation: Driver Node</h1>
        <span className="text-xs bg-violet-500/20 text-violet-300 font-bold px-2 py-1 rounded">Testing Mode</span>
      </div>

      <div className="relative flex-1">
        <DriverMap
          socketRef={socketRef as any}
          busId={busId}
          route={BRTS_ROUTES[0]}
          driverLocation={sim.currentPosition ? { ...sim.currentPosition, heading: sim.heading } : null}
        />
      </div>
    </div>
  );
}
