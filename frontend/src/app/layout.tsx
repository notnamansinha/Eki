import type { Metadata } from "next";
import "./globals.css";

import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Eki – Live Transit Tracking",
  description:
    "Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and driver-rider communication.",
  keywords: ["Ahmedabad", "bus tracking", "live GPS", "BRTS", "transit", "Eki"],
  metadataBase: new URL("https://bustrack-be165.web.app"),
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    title: "Eki Live Transit Tracking",
    description: "Real-time bus tracking for Ahmedabad.",
    siteName: "Eki Transit",
  },
  twitter: { card: "summary" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Preconnect to the origins on the actual critical path.
            apis.google.com hosts Firebase Auth's iframe JS (400ms LCP savings per Lighthouse).
            identitytoolkit is only on the critical path for /passenger's token refresh,
            not the landing page's auth iframe flow. */}
        <link rel="preconnect" href="https://apis.google.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://identitytoolkit.googleapis.com" />
        <link rel="dns-prefetch" href="https://firebaseio.com" />
      </head>
      <body
        className="min-h-full flex flex-col bg-[var(--surface-0)] text-[var(--text-primary)] antialiased font-sans"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
