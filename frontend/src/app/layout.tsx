import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

import Providers from "@/components/Providers";

const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sora",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Eki – Live Transit Tracking",
  description:
    "Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and driver-rider communication.",
  keywords: ["Ahmedabad", "bus tracking", "live GPS", "BRTS", "transit", "Eki"],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${sora.variable}`} suppressHydrationWarning>
      <head>
        {/* Preconnect to Firebase hosts for faster cold-start */}
        <link rel="preconnect" href="https://firebaseapp.com" />
        <link rel="preconnect" href="https://firebase.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="dns-prefetch" href="https://apis.google.com" />
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
