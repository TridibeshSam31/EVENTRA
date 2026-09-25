import Link from "next/link";

export default function EventsListPage() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Event Operations</h1>
          <p className="text-slate-400">All registered and active operations.</p>
        </div>
        <Link
          href="/events/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          New Event
        </Link>
      </div>
      <div className="border border-slate-800 rounded-xl p-8 text-center text-slate-500">
        No active events in current session. Create a new event to begin planning.
      </div>
    </div>
  );
}
