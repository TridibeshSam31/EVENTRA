import { redirect } from "next/navigation";

/** The old analytics route rendered nothing; the event report replaces it. */
export default function AnalyticsPage({ params }: { params: { eventId: string } }) {
  redirect(`/events/${params.eventId}/report`);
}
