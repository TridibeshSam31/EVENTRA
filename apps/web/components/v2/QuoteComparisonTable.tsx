"use client";

import React, { useState, useMemo } from "react";
import {
  DollarSign,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ArrowUpDown,
  Search,
  Filter,
  Eye,
  MessageSquare,
  Sparkles,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { QuoteEvidenceItem } from "./QuoteEvidenceDrawer";

interface QuoteComparisonTableProps {
  quotes: QuoteEvidenceItem[];
  currency?: string;
  onSelectQuote: (quote: QuoteEvidenceItem) => void;
  onOpenNegotiation?: (quote: QuoteEvidenceItem) => void;
  onRequestApproval?: (quote: QuoteEvidenceItem) => void;
  onConfirmQuote?: (quote: QuoteEvidenceItem) => void;
  className?: string;
}

type SortField = "quote" | "rating" | "date" | "none";
type SortDirection = "asc" | "desc";

export function QuoteComparisonTable({
  quotes,
  currency = "INR",
  onSelectQuote,
  onOpenNegotiation,
  onRequestApproval,
  onConfirmQuote,
  className = "",
}: QuoteComparisonTableProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("none");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Distinct categories available in quotes
  const categories = useMemo(() => {
    const set = new Set<string>();
    quotes.forEach((q) => {
      if (q.category) set.add(q.category);
    });
    return Array.from(set);
  }, [quotes]);

  // Toggle user-controlled presentation sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filtered and Presentation-Sorted list
  const processedQuotes = useMemo(() => {
    let result = quotes.filter((q) => {
      const matchesSearch =
        !search ||
        q.vendorName.toLowerCase().includes(search.toLowerCase()) ||
        q.category.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (categoryFilter !== "ALL" && q.category !== categoryFilter) {
        return false;
      }

      return true;
    });

    if (sortField !== "none") {
      result = [...result].sort((a, b) => {
        if (sortField === "quote") {
          const valA = a.quotedAmount ?? Number.MAX_VALUE;
          const valB = b.quotedAmount ?? Number.MAX_VALUE;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        }
        if (sortField === "rating") {
          const valA = a.raw?.rating ?? 0;
          const valB = b.raw?.rating ?? 0;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        }
        if (sortField === "date") {
          const valA = a.quoteTimestamp ? new Date(a.quoteTimestamp).getTime() : 0;
          const valB = b.quoteTimestamp ? new Date(b.quoteTimestamp).getTime() : 0;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        }
        return 0;
      });
    }

    return result;
  }, [quotes, search, categoryFilter, sortField, sortDirection]);

  const curr = currency === "INR" ? "₹" : `${currency} `;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Search and Category Filter Toolbar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search quotes by provider or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Category:
          </span>
          <button
            onClick={() => setCategoryFilter("ALL")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              categoryFilter === "ALL"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All ({quotes.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition whitespace-nowrap ${
                categoryFilter === cat
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop / Tablet Comparison Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 tracking-wider">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10 shadow-xs">
                  Provider
                </th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700" onClick={() => handleSort("quote")}>
                  <div className="flex items-center gap-1">
                    <span>Quoted Amount</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-4 py-3">Advance Terms</th>
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Scope / Window</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3">Negotiation State</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {processedQuotes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400 text-xs">
                    No provider quotes available matching filter criteria.
                  </td>
                </tr>
              ) : (
                processedQuotes.map((quote) => {
                  const hasQuote = quote.quotedAmount != null;
                  const isApproved = quote.approvalStatus === "APPROVED";

                  return (
                    <tr
                      key={quote.assignmentId}
                      className="hover:bg-slate-50/80 transition cursor-pointer"
                      onClick={() => onSelectQuote(quote)}
                    >
                      {/* Sticky Provider Name Column */}
                      <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10">
                        <div className="font-bold text-slate-900 text-xs">
                          {quote.vendorName}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ProvenanceBadge source={quote.provenance} size="sm" />
                          <span className="text-[10px] text-slate-400 font-mono">
                            {quote.raw?.city || "UNKNOWN"}
                          </span>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3 text-[11px] font-semibold text-slate-600 uppercase">
                        {quote.category}
                      </td>

                      {/* Quoted Price */}
                      <td className="px-4 py-3">
                        {hasQuote ? (
                          <div>
                            <span className="font-mono font-bold text-slate-900 text-sm">
                              {curr}{Number(quote.quotedAmount).toLocaleString()}
                            </span>
                            {quote.targetAmount != null && (
                              <span className="text-[10px] text-slate-400 block font-mono">
                                Target: {curr}{Number(quote.targetAmount).toLocaleString()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono">Quote unavailable</span>
                        )}
                      </td>

                      {/* Advance Terms */}
                      <td className="px-4 py-3">
                        {quote.advanceRequired === true ? (
                          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            Advance Required
                          </span>
                        ) : quote.advanceRequired === false ? (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            No Advance
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">UNKNOWN</span>
                        )}
                      </td>

                      {/* Availability */}
                      <td className="px-4 py-3">
                        {quote.availabilityConfirmed === true ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Confirmed</span>
                          </span>
                        ) : quote.availabilityConfirmed === false ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span>Unavailable</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">UNKNOWN</span>
                        )}
                      </td>

                      {/* Scope / Window */}
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700">
                        {quote.coverageStart || quote.coverageEnd
                          ? `${quote.coverageStart || "TBD"} – ${quote.coverageEnd || "TBD"}`
                          : "UNKNOWN"}
                      </td>

                      {/* Verification Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                            quote.verificationStatus === "VERIFIED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : quote.verificationStatus === "UNVERIFIED"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-slate-50 text-slate-500 border-slate-200"
                          }`}
                        >
                          {quote.verificationStatus || "Verification unavailable"}
                        </span>
                      </td>

                      {/* Negotiation State */}
                      <td className="px-4 py-3">
                        <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                          {quote.negotiationStatus}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onSelectQuote(quote)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                            title="Inspect Evidence"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {onOpenNegotiation && (
                            <button
                              onClick={() => onOpenNegotiation(quote)}
                              className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
                            >
                              Negotiate
                            </button>
                          )}

                          {onConfirmQuote && isApproved && (
                            <button
                              onClick={() => onConfirmQuote(quote)}
                              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#D6003C] hover:bg-[#b50033] text-white transition shadow-xs"
                            >
                              Confirm
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Stacked Quote Cards */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {processedQuotes.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
            No provider quotes available matching filter criteria.
          </div>
        ) : (
          processedQuotes.map((quote) => (
            <div
              key={quote.assignmentId}
              onClick={() => onSelectQuote(quote)}
              className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2.5 active:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {quote.category}
                    </span>
                    <ProvenanceBadge source={quote.provenance} size="sm" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{quote.vendorName}</h4>
                </div>

                <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                  {quote.negotiationStatus}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Quote</span>
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {quote.quotedAmount != null
                      ? `${curr}${Number(quote.quotedAmount).toLocaleString()}`
                      : "UNKNOWN"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Advance</span>
                  <span className="font-semibold text-slate-700">
                    {quote.advanceRequired === true
                      ? "Required"
                      : quote.advanceRequired === false
                      ? "None"
                      : "UNKNOWN"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-[10px] uppercase text-slate-400 font-semibold">
                  Verification: {quote.verificationStatus || "Unavailable"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectQuote(quote);
                  }}
                  className="text-xs font-semibold text-[#D6003C] hover:underline"
                >
                  View Evidence &rarr;
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
