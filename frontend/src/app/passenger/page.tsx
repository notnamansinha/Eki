"use client";

import dynamic from "next/dynamic";

const PassengerWorkspace = dynamic(
  () => import("@/components/passenger/PassengerWorkspace"),
  { ssr: false },
);

export default function PassengerPage() {
  return <PassengerWorkspace />;
}
