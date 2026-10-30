import type { CSSProperties, ReactNode } from "react";
export function useBuses() { return { buses: [] }; }
export function useDrivers() { return { drivers: [] }; }
export function Map({ children, style }: { children: ReactNode; style?: CSSProperties }) { return <div aria-label="Synthetic map" style={style}>{children}</div>; }
export function AdvancedMarker() { return null; }
export function useMap() { return null; }
export function clearCollectionCache() {}
export function clearSettingsCache() {}
export function invalidateLiveBusCache() {}
export function usePathname() { return "/admin"; }
// One stable router like Next's; navigations are recorded, not performed.
const routerReplacements: string[] = [];
Object.assign(window, { qaRouterReplacements: routerReplacements });
const router = { replace: (href: string) => { routerReplacements.push(href); } };
export function useRouter() { return router; }
export function useLinkStatus() { return { pending: false }; }
export default function Link({ children, href }: { children: ReactNode; href: string }) { return <a href={href}>{children}</a>; }
