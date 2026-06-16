"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { BRTSRoute, BRTSStop, SIMULATION_SPEED_MS } from "@/config/brtsRoutes";
import { getBearing, interpolatePosition, getDistanceKm } from "@/lib/mapUtils";

export interface SimulationState {
  currentPosition: { lat: number; lng: number } | null;
  heading: number;
  stepIndex: number;
  distanceRemainingKm: number;
  etaMinutes: number;
  hasArrived: boolean;
}

interface Props {
  route: BRTSRoute;
  targetStop: BRTSStop;
  socketRef: React.RefObject<ReturnType<typeof import("socket.io-client").io> | null>;
  busId: string;
}

const INITIAL: SimulationState = {
  currentPosition: null,
  heading: 0,
  stepIndex: 0,
  distanceRemainingKm: 0,
  etaMinutes: 0,
  hasArrived: false,
};

export function useDriverSimulation({
  route,
  targetStop,
  socketRef,
  busId,
}: Props): SimulationState {
  const [state, setState] = useState<SimulationState>(INITIAL);
  const pathRef = useRef(route.waypoints);
  const targetStopRef = useRef(targetStop);

  const idxRef = useRef(0);
  const startRef = useRef(Date.now());
  const frameRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    pathRef.current = route.waypoints;
    targetStopRef.current = targetStop;
  }, [route, targetStop]);

  const stateRef = useRef<SimulationState>(INITIAL);

  const advanceStep = useCallback(() => {
    if (finishedRef.current) return;
    const path = pathRef.current;
    if (idxRef.current >= path.length - 1) {
      finishedRef.current = true;
      setState(s => ({ ...s, hasArrived: true }));
      return;
    }
    
    idxRef.current++;
    startRef.current = Date.now();
    
    // Broadcast via socket using latest stateRef
    if (socketRef.current && stateRef.current.currentPosition) {
      socketRef.current.emit("bus:locationUpdate", {
        busId,
        routeId: route.id,
        lat: stateRef.current.currentPosition.lat,
        lng: stateRef.current.currentPosition.lng,
        heading: stateRef.current.heading,
        etaMinutes: stateRef.current.etaMinutes, 
        nextStopId: targetStopRef.current.id,
        nextStopName: targetStopRef.current.name,
        distanceRemainingKm: stateRef.current.distanceRemainingKm,
      });
    }
  }, [socketRef, busId, route.id]);

  useEffect(() => {
    idxRef.current = 0;
    startRef.current = Date.now();
    finishedRef.current = false;
    
    const id = setInterval(advanceStep, SIMULATION_SPEED_MS);
    return () => clearInterval(id);
  }, [advanceStep]);

  useEffect(() => {
    const animate = () => {
      const path = pathRef.current;
      if (finishedRef.current || path.length < 2) {
        return;
      }

      const idx = idxRef.current;
      const nIdx = Math.min(idx + 1, path.length - 1);
      const t = Math.min((Date.now() - startRef.current) / SIMULATION_SPEED_MS, 1);
      
      const from = path[idx];
      const to = path[nIdx];
      
      if (!from || !to) return;

      const pos = interpolatePosition(from, to, t);
      const hdg = getBearing(from, to);
      
      let distRemTotal = 0;
      distRemTotal += getDistanceKm(pos, to);
      for (let i = nIdx; i < path.length - 1; i++) {
        distRemTotal += getDistanceKm(path[i], path[i + 1]);
      }
      
      const newState = {
        currentPosition: pos,
        heading: hdg,
        stepIndex: idx,
        distanceRemainingKm: Number(distRemTotal.toFixed(1)),
        etaMinutes: Math.max(1, Math.ceil((distRemTotal / 25) * 60)),
        hasArrived: false,
      };

      stateRef.current = newState;
      setState(newState);

      frameRef.current = requestAnimationFrame(animate);
    };
    
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return state;
}
