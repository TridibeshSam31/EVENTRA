/**
 * The vendor journey — one vocabulary for every screen.
 *
 *   Save  →  Pick  →  Contact  →  Book
 *
 * Every button that moves a vendor forward must use these labels, so the user
 * learns one path instead of four different verbs.
 *
 *   save     addShortlistEntry / removeShortlistEntry   (keep for comparison)
 *   pick     selectShortlistCandidate                   (choose for its category)
 *   contact  approveShortlistCommunication              (EVENTRA messages / calls them)
 *   book     createAssignment / selectEventVenue        (booking proposal → Approvals)
 */

export type JourneyStep = "save" | "pick" | "contact" | "book";

export const JOURNEY: Array<{ id: JourneyStep; label: string; short: string; help: string }> = [
  { id: "save", label: "Save", short: "Saved", help: "Keep this option to compare later." },
  { id: "pick", label: "Pick", short: "Picked", help: "Choose this vendor for its category." },
  { id: "contact", label: "Approve & contact", short: "Contacted", help: "EVENTRA messages or calls them for availability and a quote." },
  { id: "book", label: "Request booking", short: "Booking requested", help: "Sends a booking proposal to Approvals. Nothing is booked until it's approved." },
];

export const JOURNEY_LABEL: Record<JourneyStep, string> = Object.fromEntries(
  JOURNEY.map((s) => [s.id, s.label])
) as Record<JourneyStep, string>;

export const JOURNEY_DONE: Record<JourneyStep, string> = Object.fromEntries(
  JOURNEY.map((s) => [s.id, s.short])
) as Record<JourneyStep, string>;

export const JOURNEY_HELP: Record<JourneyStep, string> = Object.fromEntries(
  JOURNEY.map((s) => [s.id, s.help])
) as Record<JourneyStep, string>;

export function journeyIndex(step: JourneyStep | null | undefined): number {
  return step ? JOURNEY.findIndex((s) => s.id === step) : -1;
}
