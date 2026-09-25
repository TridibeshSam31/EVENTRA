"use client";

import React from 'react';

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  // Lenis removed because it breaks nested overflow-y-auto containers in AppShell
  return <>{children}</>;
}
