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

const ROLE_DEFINITIONS = [
  {
    role: "main_organizer",
    title: "Main Organizer",
    badge: "TIER 1 • FULL GOVERNANCE",
    color: "bg-[#D6003C]/10 text-[#D6003C] border-[#D6003C]/30",
    desc: "Complete operational, financial, and administrative control. Can approve all budget escalations, vendor swaps, and critical path mutations.",
    canApproveCritical: true,
    canEditTasks: true,
    canManageBudget: true,
    canTriggerCalls: true,
  },
  {
    role: "event_manager",
    title: "Event Manager",
    badge: "TIER 2 • TACTICAL CONTROL",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    desc: "Day-of operations lead. Can manage tasks, assign vendors, resolve non-emergency incidents, and execute pre-approved recoveries.",
    canApproveCritical: false,
    canEditTasks: true,
    canManageBudget: false,
    canTriggerCalls: true,
  },
  {
    role: "collaborator",
    title: "Collaborator / Floor Lead",
    badge: "TIER 3 • ON-SITE EXECUTION",
    color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    desc: "Task execution and floor reporting. Can edit minor tasks. Any major budget or critical schedule edits automatically generate an Approval Ticket.",
    canApproveCritical: false,
    canEditTasks: true,
    canManageBudget: false,
    canTriggerCalls: false,
  },
  {
    role: "vendor",
    title: "External Vendor Partner",
    badge: "RESTRICTED DISPATCH",
    color: "bg-purple-500/10 text-purple-700 border-purple-500/30",
    desc: "Restricted partner portal. Only sees assigned work items, setup window timings, and venue loading-dock instructions.",
    canApproveCritical: false,
    canEditTasks: false,
    canManageBudget: false,
    canTriggerCalls: false,
  },
  {
    role: "viewer",
    title: "Stakeholder / Viewer",
    badge: "READ-ONLY",
    color: "bg-slate-500/10 text-slate-700 border-slate-500/30",
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

  useEffect(() => {
    async function fetchMembers() {
      setIsLoading(true);
      const data = await listCollaborators(eventId);
      setMembers(data);
      setIsLoading(false);
    }
    fetchMembers();
  }, [eventId]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    const newMember = await addCollaborator(eventId, {
      user_id: `user-${Date.now().toString().slice(-4)}`,
      name: inviteName || inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
    });

    setMembers((prev) => [...prev, newMember]);
    setShowInviteModal(false);
    setInviteName("");
    setInviteEmail("");
    setNotificationMsg(`Invited ${newMember.name} as ${newMember.role.replace("_", " ")}`);
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    await updateCollaboratorRole(eventId, memberId, newRole);
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
    setNotificationMsg("Updated operative clearance role.");
    setTimeout(() => setNotificationMsg(null), 3000);
  };

  const handleRemove = async (memberId: string) => {
    await removeCollaborator(eventId, memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    setNotificationMsg("Member access revoked.");
    setTimeout(() => setNotificationMsg(null), 3000);
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 font-sans">
      {/* Toast Notification */}
      {notificationMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-mono shadow-xl border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Top Banner / Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-[#D6003C] uppercase mb-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>OPERATIONAL RBAC & TEAM GOVERNANCE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Team Members & Access Control
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Grant team members role-based clearance to edit tasks, dispatch vendor calls, or approve critical budget and recovery changes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/events/${eventId}/approvals`}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <FileCheck2 className="w-4 h-4 text-slate-500" />
            <span>View Pending Approvals</span>
          </Link>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 rounded-lg bg-[#D6003C] hover:bg-[#B80033] text-white text-xs font-bold font-mono tracking-wider flex items-center gap-2 shadow-sm transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>INVITE OPERATIVE</span>
          </button>
        </div>
      </div>

      {/* Governance Explainer Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 mt-0.5">
            <Info className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">
              How Access & Approvals Work in EVENTRA
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every state change in EVENTRA is classified by its <strong>impact level</strong>. When a member with <strong>Collaborator</strong> clearance makes a minor update (e.g. marking a non-critical task in progress), it executes directly. But if they modify a critical-path milestone or commit budget, EVENTRA automatically intercepts the action and creates a pending ticket in <strong>Approvals & Sign-Offs</strong> for the <strong>Main Organizer</strong> or <strong>Event Manager</strong> to verify.
            </p>
          </div>
        </div>
      </div>

      {/* Role Clearance Matrix Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide font-mono">
              Clearance Levels & Permission Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Defines operational capabilities and approval requirements for each team tier.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-6 py-3">Role Tier</th>
                <th className="px-4 py-3">Edit Tasks</th>
                <th className="px-4 py-3">Trigger AI Vendor Calls</th>
                <th className="px-4 py-3">Approve Critical Actions</th>
                <th className="px-4 py-3">Manage Budget</th>
                <th className="px-6 py-3">Approval Behavior</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROLE_DEFINITIONS.map((def) => (
                <tr key={def.role} className="hover:bg-slate-50/50 transition">
                  <td className="px-6 py-3.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900 text-xs">
                        {def.title}
                      </span>
                      <span className="text-[10px] text-slate-500 mt-0.5">
                        {def.badge}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {def.canEditTasks ? (
                      <span className="inline-flex items-center text-emerald-600 font-medium gap-1">
                        <Check className="w-3.5 h-3.5" /> Allowed
                      </span>
                    ) : (
                      <span className="text-slate-400">Restricted</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {def.canTriggerCalls ? (
                      <span className="inline-flex items-center text-emerald-600 font-medium gap-1">
                        <Check className="w-3.5 h-3.5" /> Allowed
                      </span>
                    ) : (
                      <span className="text-slate-400">Restricted</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {def.canApproveCritical ? (
                      <span className="inline-flex items-center text-[#D6003C] font-semibold gap-1">
                        <ShieldCheck className="w-4 h-4" /> Full Authority
                      </span>
                    ) : (
                      <span className="text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {def.canManageBudget ? (
                      <span className="inline-flex items-center text-emerald-600 font-medium gap-1">
                        <Check className="w-3.5 h-3.5" /> Full Authority
                      </span>
                    ) : (
                      <span className="text-slate-400">View Only</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500 text-[11px]">
                    {def.role === "main_organizer"
                      ? "Direct Execution + Final Sign-off"
                      : def.role === "event_manager"
                      ? "Direct for non-emergency; Escalates budget > $500"
                      : def.role === "collaborator"
                      ? "Minor tasks direct; Major changes create Approval Ticket"
                      : "Read-only access"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Team Roster */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide font-mono">
              Active Operatives ({members.length})
            </h2>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400 font-mono text-xs">
            Loading team roster...
          </div>
        ) : members.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-mono text-xs">
            No operatives assigned to this event yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {members.map((member) => {
              const roleMeta =
                ROLE_DEFINITIONS.find((r) => r.role === member.role) || ROLE_DEFINITIONS[2];
              const isOwner = member.role === "main_organizer";

              return (
                <div
                  key={member.id}
                  className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/60 transition"
                >
                  {/* Left: Operative Info */}
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-slate-700 text-xs">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {member.name}
                        </span>
                        <span
                          className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${roleMeta.color}`}
                        >
                          {roleMeta.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3 text-slate-400" />
                          {member.email}
                        </span>
                        <span>•</span>
                        <span className="text-[11px] text-slate-400">
                          {member.lastActive || "Active"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-3 self-end sm:self-center">
                    {!isOwner && (
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#D6003C]"
                      >
                        <option value="main_organizer">Main Organizer</option>
                        <option value="event_manager">Event Manager</option>
                        <option value="collaborator">Collaborator</option>
                        <option value="vendor">Vendor Partner</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}

                    {!isOwner && (
                      <button
                        onClick={() => handleRemove(member.id)}
                        className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        title="Revoke clearance"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Invite Operative */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#D6003C]" />
                <h3 className="font-bold text-slate-900 text-base">
                  Assign Operative Clearance
                </h3>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Jordan Miller"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#D6003C]/20 focus:border-[#D6003C]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Work Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="jordan@eventra.ops"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#D6003C]/20 focus:border-[#D6003C]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Operational Clearance Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#D6003C]/20 focus:border-[#D6003C]"
                >
                  <option value="main_organizer">Main Organizer (Full Approval Authority)</option>
                  <option value="event_manager">Event Manager (Operational Approvals)</option>
                  <option value="collaborator">Collaborator (Edit tasks; major edits create approval ticket)</option>
                  <option value="vendor">Vendor Partner (Restricted task view)</option>
                  <option value="viewer">Viewer (Read-only dashboard)</option>
                </select>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-500 space-y-1">
                <span className="font-semibold text-slate-700 block">Governance Note:</span>
                Collaborators can view all tasks and update status. However, budget mutations or timeline changes exceeding safety thresholds will be routed to the <strong>Approvals Inbox</strong> before taking effect.
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#D6003C] hover:bg-[#B80033] text-white text-xs font-bold font-mono tracking-wider shadow-sm transition"
                >
                  SEND CLEARANCE INVITE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
