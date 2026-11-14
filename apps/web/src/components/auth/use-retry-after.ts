"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

/** Memory-only deadline: background-tab throttling must not extend the advertised wait. */
export function useRetryAfter() {
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);
  function start(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    const wait = Math.ceil(value);
    setDeadline(Date.now() + wait * 1000);
    setSeconds(wait);
  }
  function fromError(error: unknown) {
    if (
      error instanceof ApiError &&
      error.status === 429 &&
      error.retryAfterSeconds
    )
      start(error.retryAfterSeconds);
  }
  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) setDeadline(0);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return { seconds, start, fromError };
}
