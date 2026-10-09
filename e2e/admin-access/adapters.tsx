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
export function useRouter() { return { replace: () => {} }; }
export default function Link({ children, href }: { children: ReactNode; href: string }) { return <a href={href}>{children}</a>; }
