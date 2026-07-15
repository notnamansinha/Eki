import MapProviders from "@/components/MapProviders";

export default function RoutePlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <MapProviders>
      {children}
    </MapProviders>
  );
}
