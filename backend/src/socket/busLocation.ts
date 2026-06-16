import { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SimBusLocation,
} from "../types";

/**
 * Registers additive bus:location socket handlers.
 * Drivers (simulation) emit bus:location → server rebroadcasts to passengers + admin.
 * Existing events (driver:location-update / bus:location-update) are completely untouched.
 */
export function registerBusLocationHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
): void {
  // Simulation driver emits bus:location
  socket.on("bus:location", (data: SimBusLocation) => {
    console.log(
      `📡 [bus:location] busId=${data.busId} route=${data.routeId} ` +
        `lat=${data.lat.toFixed(5)} lng=${data.lng.toFixed(5)}`
    );

    // Broadcast to all passenger clients (same room used by trackingGateway)
    io.to("passengers").emit("bus:location", data);
    // Broadcast to admin observers
    io.to("admin").emit("bus:location", data);
  });

  // Passenger can subscribe to a specific route room for future filtered updates
  socket.on("passenger:watch-route", ({ routeId }: { routeId: string }) => {
    if (routeId) {
      socket.join(`route:${routeId}`);
      console.log(
        `👁️ [passenger:watch-route] socket ${socket.id} watching route ${routeId}`
      );
    }
  });
}
