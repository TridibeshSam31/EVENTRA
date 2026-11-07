"use client";

import { useEffect, useState } from "react";

// Internal / operator tools stay hidden for everyday users unless they opt in.
const STORAGE_KEY = "eventra.showAdvanced";
const listeners = new Set<(on: boolean) => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdvancedMode(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {}
  listeners.forEach((fn) => fn(on));
}

/** Whether "advanced tools" are switched on. Stays in sync across components. */
export function useAdvancedMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(read());
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return [on, setAdvancedMode];
}
