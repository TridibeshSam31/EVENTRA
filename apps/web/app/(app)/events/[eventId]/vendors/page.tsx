"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { EventShell } from "@/components/v2/EventShell";
import { DiscoveryCommand, resolveVendorCategory } from "@/components/v2/DiscoveryCommand";
import { QuoteBoard } from "@/components/v2/QuoteBoard";
import { Segmented } from "@/components/ds";
import { getEventQuotes } from "@/lib/api/quotes";

type Tab = "discover" | "quotes";

export default function VendorsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const eventId = params?.eventId as string;
  // Deep links (e.g. Plan → "Find a vendor") open the matching category tab.
  const initialCategory = resolveVendorCategory(searchParams?.get("category")) ?? "CATERING";
  const [tab, setTab] = useState<Tab>(searchParams?.get("tab") === "quotes" ? "quotes" : "discover");
  const [quoteCount, setQuoteCount] = useState<number | undefined>(undefined);

  // Count of quotes received, for the tab label. Failure just hides the count.
  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    getEventQuotes(eventId)
      .then((r) => {
        if (alive) setQuoteCount(r.items.filter((q) => q.quoted_amount !== null).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [eventId, tab]);

  const switchTab = (t: Tab) => {
    setTab(t);
    const sp = new URLSearchParams(searchParams?.toString() || "");
    if (t === "quotes") sp.set("tab", "quotes");
    else sp.delete("tab");
    const qs = sp.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <EventShell eventId={eventId} currentStage="DISCOVER">
      <div className="flex justify-start">
        <Segmented<Tab>
          value={tab}
          onChange={switchTab}
          options={[
            { value: "discover", label: "Find vendors" },
            { value: "quotes", label: "Quotes", count: quoteCount },
          ]}
        />
      </div>

      {/* Discovery stays mounted so its state survives switching tabs. */}
      <div hidden={tab !== "discover"}>
        <DiscoveryCommand
          key={initialCategory}
          eventId={eventId}
          discoveryType="VENDOR"
          defaultCategory={initialCategory}
          agentRunKind="PROVIDER"
        />
      </div>
      {tab === "quotes" && <QuoteBoard eventId={eventId} />}
    </EventShell>
  );
}
