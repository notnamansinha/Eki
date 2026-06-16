import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BusTrack – Live Tracking",
  description:
    "Real-time tracking, ride-hailing, and fleet management. Live GPS for passengers, drivers, and administrators.",
  keywords: ["tracking", "live GPS", "fleet management"],
  icons: {
    icon: "/BusLogo.png",
  },
};

import Providers from "@/components/Providers";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-brand-dark text-white antialiased" suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
