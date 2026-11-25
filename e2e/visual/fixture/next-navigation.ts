// Stand-in for next/navigation. Navigation is recorded, never performed, so a
// surface stays on screen for its screenshot.
const visited: string[] = [];
const router = {
  push: (href: string) => { visited.push(href); },
  replace: (href: string) => { visited.push(href); },
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
};

export function useRouter() { return router; }
export function usePathname() { return location.pathname; }
export function useSearchParams() { return new URLSearchParams(location.search); }
