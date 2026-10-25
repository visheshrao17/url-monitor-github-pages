#!/usr/bin/env python3
"""Check configured URLs and append results to history.csv using only the Python standard library."""

import csv
import json
import os
import socket
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
HISTORY_PATH = BASE_DIR / "history.csv"
FIELDS = [
    "timestamp_utc",
    "url",
    "status_code",
    "response_time_ms",
    "result",
    "error",
]

# A small, identifiable user agent helps services understand what is making the request.
USER_AGENT = "GitHubActions-URLMonitor/1.0"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)

    urls = config.get("urls")
    if not isinstance(urls, list) or len(urls) != 2:
        raise ValueError("config.json must contain exactly two URLs in the 'urls' array.")

    for url in urls:
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise ValueError(f"Invalid URL in config.json: {url!r}")

    timeout = float(config.get("timeout_seconds", 15))
    if timeout <= 0:
        raise ValueError("timeout_seconds must be greater than zero.")

    return urls, timeout


def check_url(url, timeout_seconds):
    """Return a history row. HTTP 2xx/3xx is UP; other HTTP statuses are DOWN."""
    started = time.perf_counter()
    status_code = ""
    result = "DOWN"
    error_message = ""

    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
        method="GET",
    )

    try:
        # Read a small amount of the body so connection/read errors can be detected.
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            status_code = response.getcode()
            response.read(1024)
            result = "UP" if 200 <= status_code < 400 else "DOWN"
            if result == "DOWN":
                error_message = f"HTTP {status_code}"
    except urllib.error.HTTPError as exc:
        # urllib raises HTTPError for responses such as 404 and 500; these are still HTTP responses.
        status_code = exc.code
        result = "UP" if 200 <= status_code < 400 else "DOWN"
        error_message = "" if result == "UP" else f"HTTP {exc.code} {exc.reason}"
        try:
            exc.close()
        except Exception:
            pass
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, (socket.timeout, TimeoutError)):
            error_message = f"Timeout after {timeout_seconds:g}s"
        else:
            error_message = f"URL error: {reason}"
    except (socket.timeout, TimeoutError):
        error_message = f"Timeout after {timeout_seconds:g}s"
    except (ConnectionError, OSError) as exc:
        error_message = f"Connection/OS error: {exc}"
    except Exception as exc:
        error_message = f"{type(exc).__name__}: {exc}"

    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

    return {
        "timestamp_utc": utc_now(),
        "url": url,
        "status_code": status_code,
        "response_time_ms": elapsed_ms,
        "result": result,
        "error": error_message,
    }


def ensure_history_file():
    if not HISTORY_PATH.exists() or HISTORY_PATH.stat().st_size == 0:
        with HISTORY_PATH.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()


def append_rows(rows):
    ensure_history_file()
    with HISTORY_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writerows(rows)


def main():
    urls, timeout_seconds = load_config()
    rows = []

    for url in urls:
        row = check_url(url, timeout_seconds)
        rows.append(row)
        print(
            f"{row['timestamp_utc']} | {row['result']} | "
            f"HTTP {row['status_code'] or 'N/A'} | "
            f"{row['response_time_ms']} ms | {url} | {row['error']}"
        )

    append_rows(rows)
    down_count = sum(row["result"] == "DOWN" for row in rows)
    print(f"Saved {len(rows)} check results to {HISTORY_PATH.name}.")
    if down_count:
        print(f"WARNING: {down_count} URL check(s) failed.")
        # Keep the workflow successful so the history commit can still happen.
        # Failures are represented in history.csv and on the dashboard.


if __name__ == "__main__":
    main()
