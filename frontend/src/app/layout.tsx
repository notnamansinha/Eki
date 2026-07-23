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
        {/* Only preconnect to origins that are on the critical path.
            Unused preconnects waste resources and are penalised by Lighthouse. */}
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" />
        <link rel="dns-prefetch" href="https://apis.google.com" />
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
