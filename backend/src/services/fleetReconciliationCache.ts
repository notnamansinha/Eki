export class FleetReconciliationCache {
  private readonly routeLoads = new Map<string, Promise<string[]>>();

  constructor(
    private readonly mirrors: Record<string, unknown>,
    private readonly loadRoutes: (busId: string) => Promise<string[]>,
  ) {}

  mirrorFor(driverId: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.mirrors, driverId)
      ? this.mirrors[driverId]
      : null;
  }

  setMirror(driverId: string, value: unknown): void {
    if (value === null) delete this.mirrors[driverId];
    else this.mirrors[driverId] = value;
  }

  routesForBus(busId: string): Promise<string[]> {
    const existing = this.routeLoads.get(busId);
    if (existing) return existing;
    const load = this.loadRoutes(busId).catch((error) => {
      this.routeLoads.delete(busId);
      throw error;
    });
    this.routeLoads.set(busId, load);
    return load;
  }
}
