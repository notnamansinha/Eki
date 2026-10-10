"use client";

import dynamic from "next/dynamic";

const FeedbackPanel = dynamic(() => import("@/components/admin/FeedbackPanel"), {
  ssr: false,
  loading: () => (
    <div className="min-h-dvh grid place-items-center bg-brand-dark text-white/80" role="status" aria-label="Loading feedback">
      Loading feedback…
    </div>
  ),
});

export default function FeedbackPage() {
  return <FeedbackPanel />;
}
