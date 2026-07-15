import type { Metadata } from "next";
import "./globals.css";

// Load only the two most-used weights eagerly; others are deferred by
// font-display:swap in globals.css so they never block first paint.
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/700.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Eki – Live Transit Tracking",
  description:
    "Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and driver-rider communication.",
  keywords: ["Ahmedabad", "bus tracking", "live GPS", "BRTS", "transit", "Eki"],
  icons: {
    icon: "/BusLogo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Preconnect to Firebase hosts for faster cold-start */}
        <link rel="preconnect" href="https://firebaseapp.com" />
        <link rel="preconnect" href="https://firebase.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="dns-prefetch" href="https://apis.google.com" />
      </head>
      <body
        className="min-h-full flex flex-col bg-[var(--surface-0)] text-[var(--text-primary)] antialiased"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
