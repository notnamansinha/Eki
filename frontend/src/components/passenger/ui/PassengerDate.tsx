"use client";

import { useEffect, useState } from "react";

const dateFormat = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });

/** Today's date above the Live Routes title; refreshes if the panel stays open past midnight. */
export default function PassengerDate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="pp-kicker">
      <time dateTime={now.toISOString().slice(0, 10)}>{dateFormat.format(now)}</time>
    </p>
  );
}
