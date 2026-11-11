import type { Metadata } from "next";
import Link from "next/link";

// The static export writes this page to 404.html, which Firebase Hosting
// serves with HTTP 404 for every path that has no file. Next.js adds its own
// `noindex`; setting robots here also replaces the root layout's
// `index, follow`, so the page no longer sends both.
export const metadata: Metadata = {
  title: "Page not found",
  description: "This Eki page does not exist.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main
      className="flex min-h-dvh w-full flex-1 flex-col items-center justify-center gap-5 bg-[#f2efec] px-4 py-10 text-center text-[#434747] [font-family:var(--font-roboto),system-ui,sans-serif] dark:bg-[#09090b] dark:text-[#ececef]"
    >
      <p className="text-sm font-bold uppercase tracking-widest text-[#801214] dark:text-[#f3a4a5]">404</p>
      <h1 className="max-w-[20ch] text-balance text-3xl font-bold [font-family:var(--font-playfair),Georgia,serif] sm:text-4xl">
        This page does not exist
      </h1>
      <p className="max-w-[34em] text-balance text-[#5c6060] dark:text-[#94949c]">
        The link may be old or mistyped. Live buses and routes are on Eki&apos;s home page.
      </p>
      <Link
        href="/"
        className="rounded-full bg-[#801214] px-6 py-3 text-base font-bold text-white hover:bg-[#6a0f11] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#801214] dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:focus-visible:outline-white"
      >
        Go to Eki home
      </Link>
    </main>
  );
}
