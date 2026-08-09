const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function backendOriginFromUrl(value) {
  if (!value?.trim()) return null;

  const backendUrl = new URL(value);
  const isLocal = LOCAL_HOSTS.has(backendUrl.hostname);
  if (
    !HTTP_PROTOCOLS.has(backendUrl.protocol) ||
    (!isLocal && backendUrl.protocol !== "https:") ||
    backendUrl.username ||
    backendUrl.password
  ) {
    throw new Error(
      "NEXT_PUBLIC_BACKEND_URL must be HTTP(S), use HTTPS outside local development, and contain no credentials.",
    );
  }
  return backendUrl.origin;
}
