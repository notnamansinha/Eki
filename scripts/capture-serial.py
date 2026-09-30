"""Capture a bounded serial diagnostic trace without changing the device."""

import argparse
import time
from pathlib import Path

import serial


parser = argparse.ArgumentParser()
parser.add_argument("--port", required=True)
parser.add_argument("--baud", type=int, default=115200)
parser.add_argument("--duration", type=int, required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()

output = Path(args.out)
output.parent.mkdir(parents=True, exist_ok=True)
deadline = time.monotonic() + args.duration
line_count = 0
with serial.Serial(args.port, args.baud, timeout=0.25) as device, output.open(
    "w", encoding="utf-8", newline="\n"
) as trace:
    while time.monotonic() < deadline:
        raw = device.readline()
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        trace.write(f"{time.time_ns() // 1_000_000} {line}\n")
        trace.flush()
        line_count += 1

print(f"Captured {line_count} serial lines to {output}")
