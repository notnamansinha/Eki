import MapProviders from "@/components/MapProviders";

export default function ExtraLayout({ children }: { children: React.ReactNode }) {
  return (
    <MapProviders>
      {children}
    </MapProviders>
  );
}
