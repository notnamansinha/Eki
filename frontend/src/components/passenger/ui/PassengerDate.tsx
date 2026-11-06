"use client";

import { useEffect, useState } from "react";

const dateFormat = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });

/** YYYY-MM-DD in the browser's zone, matching the visible date (toISOString is UTC). */
export function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's date above the Live Routes title; refreshes if the panel stays open past midnight. */
export default function PassengerDate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="pp-kicker">
      <time dateTime={localDateKey(now)}>{dateFormat.format(now)}</time>
    </p>
  );
}
