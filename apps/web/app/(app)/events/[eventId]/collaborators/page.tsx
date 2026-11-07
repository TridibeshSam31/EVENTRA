"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Radio,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  Trash2,
  ArrowRight,
  Info,
  Check,
  Lock,
  Unlock,
  AlertCircle,
  Compass,
  FileCheck2,
} from "lucide-react";
import {
  listCollaborators,
  addCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  type EventMemberItem,
} from "@/lib/api/collaborators";
import { EventShell } from "@/components/v2/EventShell";
import { PageHeader } from "@/components/ds";

const ROLE_DEFINITIONS = [
  {
    role: "main_organizer",
    title: "Main Organizer",
    badge: "Full control",
    color: "bg-cue-50 text-cue-700 border-cue-200",
    desc: "Complete operational, financial, and administrative control. Can approve all budget escalations, vendor swaps, and critical path mutations.",
    canApproveCritical: true,
    canEditTasks: true,
    canManageBudget: true,
    canTriggerCalls: true,
  },
  {
    role: "event_manager",
    title: "Event Manager",
    badge: "Runs the day",
    color: "bg-info-50 text-info-700 border-info-200",
    desc: "Day-of operations lead. Can manage tasks, assign vendors, resolve non-emergency incidents, and execute pre-approved recoveries.",
    canApproveCritical: false,
    canEditTasks: true,
    canManageBudget: false,
    canTriggerCalls: true,
  },
  {
    role: "collaborator",
    title: "Collaborator / Floor Lead",
    badge: "On-site",
    color: "bg-go-50 text-go-700 border-go-200",
    desc: "Task execution and floor reporting. Can edit minor tasks. Any major budget or critical schedule edits automatically generate an Approval Ticket.",
    canApproveCritical: false,
    canEditTasks: true,
    canManageBudget: false,
    canTriggerCalls: false,
  },
  {
    role: "vendor",
    title: "External Vendor Partner",
    badge: "External",
    color: "bg-standby-50 text-standby-800 border-standby-200",
    desc: "Restricted partner portal. Only sees assigned work items, setup window timings, and venue loading-dock instructions.",
    canApproveCritical: false,
    canEditTasks: false,
    canManageBudget: false,
    canTriggerCalls: false,
  },
  {
    role: "viewer",
    title: "Stakeholder / Viewer",
    badge: "Read-only",
    color: "bg-ink-100 text-ink-700 border-ink-200",
    desc: "Read-only access to live telemetry, schedule progress, and executive dashboard summaries.",
    canApproveCritical: false,
    canEditTasks: false,
    canManageBudget: false,
    canTriggerCalls: false,
  },
];

export default function CollaboratorsPage() {
  const params = useParams();
  const eventId = (params?.eventId as string) || "conference_demo";

  const [members, setMembers] = useState<EventMemberItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("collaborator");
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function fetchMembers() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await listCollaborators(eventId);
        setMembers(data);
      } catch (err: any) {
        setLoadError(err?.message || "The server didn't respond.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchMembers();
  }, [eventId, reloadKey]);

  const flash = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => setNotificationMsg(null), 3500);
  };

  // Email invitations don't exist in the backend yet: a member is added by their EVENTRA user ID.
  // Success is only reported after the server confirms the member was saved.
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = inviteEmail.trim();
    if (!userId) return;
    setIsSaving(true);
    setInviteError(null);
    try {
      const newMember = await addCollaborator(eventId, { user_id: userId, role: inviteRole });
      setMembers((prev) => [...prev, newMember]);
      setShowInviteModal(false);
      setInviteName("");
      setInviteEmail("");
      flash(`Added ${newMember.name} as ${newMember.role.replace("_", " ")}`);
    } catch (err: any) {
      setInviteError(err?.message || "Couldn't add this person. Nothing was saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    setActionError(null);
    try {
      await updateCollaboratorRole(eventId, memberId, newRole);
    } catch (err: any) {
      setActionError(`Role not changed: ${err?.message || "the server didn't accept the change."}`);
      return;
    }
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? {
              ...m,
              role: newRole,
              permissions: {
                canApproveCritical: newRole === "main_organizer",
                canEditTasks: ["main_organizer", "event_manager", "collaborator"].includes(newRole),
                canManageBudget: newRole === "main_organizer",
                canTriggerAgentCalls: ["main_organizer", "event_manager"].includes(newRole),
              },
            }
          : m
      )
    );
    flash("Role updated.");
  };

  const handleRemove = async (memberId: string) => {
    setActionError(null);
    try {
      await removeCollaborator(eventId, memberId);
    } catch (err: any) {
      setActionError(`Access not removed: ${err?.message || "the server didn't accept the change."}`);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    flash("Access removed.");
  };

  const PERMS: Array<{ key: "canEditTasks" | "canTriggerCalls" | "canApproveCritical" | "canManageBudget"; label: string }> = [
    { key: "canEditTasks", label: "Edit tasks" },
    { key: "canTriggerCalls", label: "Start AI vendor calls" },
    { key: "canApproveCritical", label: "Approve critical actions" },
    { key: "canManageBudget", label: "Manage budget" },
  ];

  return (
    <EventShell eventId={eventId} currentStage="READY">
      <div className="space-y-6">
        {notificationMsg && (
          <div
            role="status"
            className="fixed bottom-6 right-6 z-50 flex animate-rise-in items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-[13px] text-ink-50 shadow-xl"
          >
            <CheckCircle2 className="h-4 w-4 text-go-400" />
            {notificationMsg}
          </div>
        )}

        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              Run <span className="text-ink-300">/</span> Team
            </span>
          }
          title="Team & access"
          description="Who can change the plan, call vendors and approve spending for this event."
          actions={
            <>
              <Link href={`/events/${eventId}/approvals`} className="btn-secondary">
                <FileCheck2 className="h-3.5 w-3.5" />
                Pending approvals
              </Link>
              <button onClick={() => setShowInviteModal(true)} className="btn-primary">
                <UserPlus className="h-3.5 w-3.5" />
                Add someone
              </button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* ── Roster ───────────────────────────── */}
          <section className="surface overflow-hidden xl:col-span-7">
            <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-ink-900">People on this event</h2>
              <span className="font-mono text-[11px] text-ink-400">{members.length}</span>
            </header>

            {actionError && (
              <div role="alert" className="flex items-start gap-2 border-b border-cue-200 bg-cue-50/70 px-5 py-2.5 text-[12.5px] text-cue-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{actionError}</span>
                <button type="button" onClick={() => setActionError(null)} className="text-[12px] font-semibold underline">
                  Dismiss
                </button>
              </div>
            )}
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="workspace-shimmer h-14 rounded-lg" />
                ))}
              </div>
            ) : loadError ? (
              <div className="px-6 py-14 text-center" role="alert">
                <AlertCircle className="mx-auto mb-3 h-6 w-6 text-cue-500" />
                <p className="text-[13.5px] font-semibold text-ink-800">Couldn&apos;t load your team</p>
                <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-ink-600">
                  {loadError} This doesn&apos;t mean nobody has access — we just couldn&apos;t check.
                </p>
                <button onClick={() => setReloadKey((k) => k + 1)} className="btn-secondary mt-4">
                  Try again
                </button>
              </div>
            ) : members.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Users className="mx-auto mb-3 h-6 w-6 text-ink-300" />
                <p className="text-[13.5px] font-semibold text-ink-800">Only you so far</p>
                <p className="mt-1 text-[12.5px] text-ink-600">Add your event manager or floor leads so they can help run the day.</p>
                <button onClick={() => setShowInviteModal(true)} className="btn-secondary mt-4">
                  <UserPlus className="h-3.5 w-3.5" /> Add someone
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {members.map((member) => {
                  const roleMeta = ROLE_DEFINITIONS.find((r) => r.role === member.role) || ROLE_DEFINITIONS[2];
                  const isOwner = member.role === "main_organizer";
                  return (
                    <li key={member.id} className="flex flex-col gap-3 px-5 py-3.5 transition hover:bg-ink-50/70 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-900 font-display text-[13px] font-bold text-ink-50">
                          {member.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-semibold text-ink-900">{member.name}</span>
                            <span className={`chip ${roleMeta.color}`}>{roleMeta.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-600">
                            {member.email ? (
                              <>
                                <Mail className="h-3 w-3 text-ink-500" />
                                <span className="truncate">{member.email}</span>
                              </>
                            ) : (
                              <span className="truncate font-mono text-[11.5px]">ID {member.user_id}</span>
                            )}
                            {member.lastActive && !Number.isNaN(new Date(member.lastActive).getTime()) && (
                              <>
                                <span className="text-ink-300">·</span>
                                <span>Added {new Date(member.lastActive).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {!isOwner && (
                        <div className="flex items-center gap-1.5 self-end sm:self-center">
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value)}
                            aria-label={`Role for ${member.name}`}
                            className="h-8 rounded-lg border border-ink-200 bg-[#FDFCFA] px-2.5 text-[12.5px] font-medium text-ink-800 focus:border-ink-400 focus:outline-none"
                          >
                            <option value="main_organizer">Main Organizer</option>
                            <option value="event_manager">Event Manager</option>
                            <option value="collaborator">Collaborator</option>
                            <option value="vendor">Vendor Partner</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          <button
                            onClick={() => handleRemove(member.id)}
                            className="rounded-md p-1.5 text-ink-400 transition hover:bg-cue-50 hover:text-cue-600"
                            title="Remove access"
                            aria-label={`Remove ${member.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── How approvals work ───────────────── */}
          <aside className="surface-sunk p-5 xl:col-span-5">
            <div className="eyebrow mb-2 flex items-center gap-2">
              <Info className="h-3.5 w-3.5" /> How access works
            </div>
            <p className="text-[13px] leading-relaxed text-ink-700">
              Every change is classified by its <strong>impact</strong>. Small updates, like marking a task in progress, happen straight away. Changes to the critical path or to the budget become a request in <strong>Approvals</strong> for the main organizer or event manager to confirm.
            </p>
            <ol className="mt-4 space-y-2">
              {[
                { t: "Someone makes a change", d: "A collaborator edits a task or a booking." },
                { t: "EVENTRA checks the impact", d: "The engine decides whether it needs sign-off." },
                { t: "An approver decides", d: "Low-impact changes apply; high-impact ones wait for approval." },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-900 font-mono text-[10px] font-semibold text-ink-50">{i + 1}</span>
                  <span>
                    <span className="block text-[13px] font-semibold text-ink-900">{s.t}</span>
                    <span className="block text-[12px] text-ink-500">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        {/* ── Permission matrix ───────────────────── */}
        <section className="surface overflow-hidden">
          <header className="border-b border-ink-200 px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-ink-900">What each role can do</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-ink-200 font-mono text-[10px] uppercase tracking-label text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  {PERMS.map((p) => (
                    <th key={p.key} className="px-3 py-2.5 text-center font-medium">
                      {p.label}
                    </th>
                  ))}
                  <th className="px-5 py-2.5 font-medium">When approval is needed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ROLE_DEFINITIONS.map((def) => (
                  <tr key={def.role} className="transition hover:bg-ink-50/70">
                    <td className="px-5 py-3">
                      <div className="text-[13px] font-semibold text-ink-900">{def.title}</div>
                      <div className="text-[11.5px] text-ink-500">{def.badge}</div>
                    </td>
                    {PERMS.map((p) => (
                      <td key={p.key} className="px-3 py-3 text-center">
                        {def[p.key] ? (
                          <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-go-500 text-white" aria-label="Allowed">
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                        ) : (
                          <span className="inline-block h-[2px] w-3 rounded bg-ink-300" aria-label="Not allowed" />
                        )}
                      </td>
                    ))}
                    <td className="px-5 py-3 text-[12px] text-ink-600">
                      {def.role === "main_organizer"
                        ? "Acts directly; gives final sign-off"
                        : def.role === "event_manager"
                        ? "Direct for non-emergencies; budget over $500 needs approval"
                        : def.role === "collaborator"
                        ? "Small tasks direct; bigger changes need approval"
                        : "Read-only"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {showInviteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md animate-rise-in rounded-2xl border border-ink-200 bg-[#FDFCFA] shadow-2xl">
              <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4">
                <h3 className="text-[16px] font-semibold text-ink-900">Add someone</h3>
                <button onClick={() => setShowInviteModal(false)} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800" aria-label="Close">
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
              <form onSubmit={handleInviteSubmit} className="space-y-4 px-6 py-5">
                <p className="rounded-lg border border-standby-200 bg-standby-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-standby-900">
                  Email invitations aren&apos;t available yet. Ask your teammate for their EVENTRA user ID and add them with it.
                </p>
                <Field label="Their EVENTRA user ID" required>
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="e.g. ops-lead-priya"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Role">
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className={inputCls}>
                    <option value="main_organizer">Main Organizer — full approval authority</option>
                    <option value="event_manager">Event Manager — can approve</option>
                    <option value="collaborator">Collaborator — edits tasks; big changes need approval</option>
                    <option value="vendor">Vendor Partner — sees only their tasks</option>
                    <option value="viewer">Viewer — read-only</option>
                  </select>
                </Field>
                <p className="rounded-lg bg-ink-100/70 px-3 py-2.5 text-[12px] leading-relaxed text-ink-600">
                  Collaborators can see every task and update status. Budget or timeline changes beyond safe limits go to <strong>Approvals</strong> first.
                </p>
                {inviteError && (
                  <p role="alert" className="rounded-lg border border-cue-200 bg-cue-50 px-3 py-2 text-[12.5px] text-cue-800">
                    {inviteError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setShowInviteModal(false)} className="btn-ghost">
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    {isSaving ? "Adding…" : "Add to event"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </EventShell>
  );
}

const inputCls =
  "h-10 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:bg-white focus:outline-none";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-semibold text-ink-700">
        {label} {required && <span className="text-cue-600">*</span>}
      </span>
      {children}
    </label>
  );
}
