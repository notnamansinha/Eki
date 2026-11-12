import type { Metadata, Viewport } from "next";
import { Playfair_Display, Roboto } from "next/font/google";
import "./globals.css";

import Providers from "@/components/Providers";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import { publicPageSocialMetadata, siteOrigin, siteIndexingEnabled } from "@/lib/siteMetadata";


// Ahmedabad University's web pair, self-hosted at build time so the CSP needs
// no font origin. Only the variables are set here; each surface opts in.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-playfair",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Browser and installed-app status bar colour: the dark landing page.
  // Passenger and Admin set their own page colour in their layouts.
  themeColor: "#09090b",
};

export const metadata: Metadata = {
  title: {
    default: "Eki – Live Transit Tracking",
    template: "%s | Eki",
  },
  description:
    "Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and passenger-admin communication.",
  keywords: ["Ahmedabad", "bus tracking", "live GPS", "BRTS", "transit", "Eki"],
  metadataBase: new URL(siteOrigin()),
  alternates: { canonical: "/" },
  robots: { index: siteIndexingEnabled(), follow: siteIndexingEnabled() },
  ...publicPageSocialMetadata({
    path: "/",
    title: "Eki Live Transit Tracking",
    description: "Real-time bus tracking for Ahmedabad.",
  }),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${roboto.variable} ${playfair.variable}`} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Preconnect to the origins on the actual critical path.
            apis.google.com hosts Firebase Auth's iframe JS (400ms LCP savings per Lighthouse).
            identitytoolkit is only on the critical path for /passenger's token refresh,
            not the landing page's auth iframe flow. */}
        <link rel="preconnect" href="https://apis.google.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        <link rel="dns-prefetch" href="https://maps.gstatic.com" />
        <link rel="dns-prefetch" href="https://identitytoolkit.googleapis.com" />
        <link rel="dns-prefetch" href="https://firebaseio.com" />
        {/* Firebase auth's token-refresh endpoint — hit on every PWA cold start
            for returning users. DNS-prefetch is enough since it's not on the
            synchronous critical path. */}
        <link rel="dns-prefetch" href="https://securetoken.googleapis.com" />
      </head>
      <body
        className="min-h-full flex flex-col bg-[var(--surface-0)] text-[var(--text-primary)] antialiased font-sans"
        suppressHydrationWarning
      >
        <ServiceWorkerRegistrar />
        <Providers>{children}</Providers>

      </body>
    </html>
  );
}
