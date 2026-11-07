"use client";

import React from "react";
import { useGuideController } from "@/stores/guideStore";
import { NextStepCard, NextStepPill } from "./NextStepCard";
import { GuideCoachMark } from "./GuideCoachMark";

/** Mounted once by AppShell on event routes: loads the guide and renders card, pill and coach mark. */
export function GuideLayer({ eventId, pathname }: { eventId: string | null; pathname: string | null }) {
  useGuideController(eventId, pathname);
  if (!eventId) return null;
  return (
    <>
      <NextStepCard />
      <NextStepPill />
      <GuideCoachMark />
    </>
  );
}

export { NextStepCard, NextStepPill } from "./NextStepCard";
export { GuideCoachMark } from "./GuideCoachMark";
export { ReadinessStrip, ReadinessChecklist } from "./Readiness";
