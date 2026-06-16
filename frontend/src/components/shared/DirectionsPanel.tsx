"use client";

import React from "react";
import { Clock, Navigation, MapPin, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

interface DirectionsPanelProps {
  result: any; // Using any for v2 response flexibility
  isOpen: boolean;
  onToggle: () => void;
}

export default function DirectionsPanel({ result, isOpen, onToggle }: DirectionsPanelProps) {
  if (!result || !result.routes?.[0]) return null;

  const route = result.routes[0];
  const leg = route.legs?.[0];
  
  // Format Duration (e.g. "1200s" -> "20 mins")
  const durationSeconds = parseInt(route.duration || "0");
  const duration = durationSeconds > 0 
    ? `${Math.round(durationSeconds / 60)} mins` 
    : "N/A";

  // Format Distance (e.g. 5000 -> "5.0 km")
  const distance = route.distanceMeters 
    ? `${(route.distanceMeters / 1000).toFixed(1)} km` 
    : "N/A";

  return (
    <div className={`fixed bottom-6 right-6 z-[1000] transition-all duration-300 ease-in-out ${isOpen ? 'w-80' : 'w-64'}`}>
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col">
        {/* Header / Summary */}
        <div 
          className="p-4 bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition-colors flex items-center justify-between"
          onClick={onToggle}
        >
          <div className="flex items-center gap-3">
             <div className="bg-white/20 p-2 rounded-lg">
                <Navigation className="w-5 h-5" />
             </div>
             <div>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Arrival Time</p>
                <p className="text-xl font-black">{duration}</p>
             </div>
          </div>
          {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
        </div>

        {/* Stats Row */}
        <div className="flex border-b border-gray-100 bg-gray-50/50">
           <div className="flex-1 p-3 flex items-center gap-2 border-r border-gray-100">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold text-gray-600">{duration}</span>
           </div>
           <div className="flex-1 p-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-gray-600">{distance}</span>
           </div>
        </div>

        {/* Steps List (Scrollable) */}
        {isOpen && (
          <div className="max-h-64 overflow-y-auto bg-white p-2">
            <div className="space-y-1">
              {leg?.steps?.map((step: any, idx: number) => (
                <div key={idx} className="flex gap-3 p-3 rounded-xl hover:bg-blue-50/50 transition-colors group">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 group-hover:scale-125 transition-transform" />
                    {idx < leg.steps.length - 1 && <div className="w-[1px] h-full bg-gray-200" />}
                  </div>
                  <div className="flex-1">
                    <div 
                      className="text-[11px] text-gray-700 font-medium leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: step.navigationInstruction?.instructions || "Drive" }}
                    />
                    <div className="flex items-center gap-2 mt-1 opacity-60">
                       <span className="text-[10px] font-bold text-blue-600">
                          {step.distanceMeters ? `${(step.distanceMeters / 1000).toFixed(1)} km` : ""}
                       </span>
                       <ChevronRight className="w-3 h-3 text-gray-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Destination Highlight */}
            <div className="mt-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center gap-3">
               <div className="bg-emerald-500 p-2 rounded-lg text-white">
                  <MapPin className="w-4 h-4" />
               </div>
               <span className="text-xs font-bold text-emerald-800">You will arrive at your destination</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
