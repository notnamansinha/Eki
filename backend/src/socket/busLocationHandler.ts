import { Server, Socket } from "socket.io";

export function registerBusLocationHandlers(
  io: Server,
  socket: Socket
): void {
  // Passenger joins a route room
  socket.on("passenger:joinRoute", ({ routeId }: { routeId: string }) => {
    socket.join(`route:${routeId}`);
  });

  socket.on("passenger:leaveRoute", ({ routeId }: { routeId: string }) => {
    socket.leave(`route:${routeId}`);
  });

  // Driver broadcasts location → forward only to passengers on that route
  socket.on(
    "bus:locationUpdate",
    (payload: {
      busId: string;
      routeId: string;
      lat: number;
      lng: number;
      heading: number;
      etaMinutes: number;
      nextStopId: string;
      nextStopName: string;
      distanceRemainingKm: number;
    }) => {
      // Broadcast to all passengers in this route room (excluding driver)
      socket.to(`route:${payload.routeId}`).emit("bus:locationUpdate", payload);
    }
  );
}
