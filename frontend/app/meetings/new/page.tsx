"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createMeeting, getCurrentUser, getErrorMessage, getWorkspaceUsers, type MeetingRole, type User } from "@/lib/api";

const meetingRoles: MeetingRole[] = ["Meeting participant", "Meeting organiser", "Reviewer/editor"];

type InviteDraft = { userId: string; role: MeetingRole };

export default function CreateMeetingPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<InviteDraft[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then(async (user) => {
        if (user.role !== "Workspace administrator") {
          setError("Only a workspace administrator can create a meeting space.");
          return;
        }
        setCurrentUser(user);
        setUsers((await getWorkspaceUsers()).filter((member) => member.approval_status === "approved"));
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.message === "Sign in required") {
          window.location.replace("/login");
          return;
        }
        setError(getErrorMessage(caught));
      })
      .finally(() => setLoading(false));
  }, []);

  function updateInvite(index: number, patch: Partial<InviteDraft>) {
    setInvites((current) => current.map((invite, inviteIndex) => inviteIndex === index ? { ...invite, ...patch } : invite));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const localStart = String(form.get("starts_at") ?? "");
    if (!localStart) {
      setError("Choose a date and time for the meeting.");
      setSaving(false);
      return;
    }
    try {
      const meeting = await createMeeting({
        title: String(form.get("title") ?? "").trim(),
        starts_at: new Date(localStart).toISOString(),
        agenda: String(form.get("agenda") ?? "").trim(),
        participants: invites.map((invite) => ({ user_id: Number(invite.userId), role: invite.role })),
      });
      window.location.assign(`/meetings/${meeting.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught));
      setSaving(false);
    }
  }

  const selectedIds = new Set(invites.map((invite) => invite.userId).filter(Boolean));
  const selectableUsers = users.filter((user) => user.id !== currentUser?.id);

  return (
    <section className="meeting-form-page">
      <div className="meeting-form-heading">
        <Link className="button button-quiet meeting-back-button" href="/meetings"><span aria-hidden="true">←</span> Back to meetings</Link>
        <div className="eyebrow">WORKSPACE ADMINISTRATION</div>
        <h1>Create a meeting space</h1>
        <p>Choose approved participants for this meeting space. You can start its group video call from the space after it’s created.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="meeting-empty">Loading approved users…</p> : currentUser && !error && (
        <form className="meeting-form" onSubmit={submit}>
          <label htmlFor="meeting-title">Meeting name</label>
          <input id="meeting-title" name="title" maxLength={200} placeholder="e.g. Product planning" required />
          <label htmlFor="meeting-start">Date and time</label>
          <input id="meeting-start" name="starts_at" type="datetime-local" required />
          <label htmlFor="meeting-agenda">Agenda</label>
          <textarea id="meeting-agenda" name="agenda" rows={5} maxLength={5000} placeholder="Topics, decisions to make, or preparation notes" />

          <div className="invite-section">
            <div className="invite-heading"><div><h2>Invite people</h2><p>You’ll be added as the meeting organiser.</p></div><button className="button button-quiet" type="button" onClick={() => setInvites((current) => [...current, { userId: "", role: "Meeting participant" }])}>Add invitee</button></div>
            {selectableUsers.length === 0 && <p className="invite-empty">No other approved accounts are available.</p>}
            {invites.map((invite, index) => {
              const choices = selectableUsers.filter((user) => user.id.toString() === invite.userId || !selectedIds.has(user.id.toString()));
              return (
                <div className="invite-row" key={index}>
                  <div><label htmlFor={`invite-user-${index}`}>Approved user</label><select id={`invite-user-${index}`} required value={invite.userId} onChange={(event) => updateInvite(index, { userId: event.target.value })}>
                    <option value="">Select a user</option>
                    {choices.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.email}</option>)}
                  </select></div>
                  <div><label htmlFor={`invite-role-${index}`}>Meeting role</label><select id={`invite-role-${index}`} value={invite.role} onChange={(event) => updateInvite(index, { role: event.target.value as MeetingRole })}>
                    {meetingRoles.map((role) => <option key={role}>{role}</option>)}
                  </select></div>
                  <button className="text-action text-action-reject" type="button" aria-label="Remove invitee" onClick={() => setInvites((current) => current.filter((_, inviteIndex) => inviteIndex !== index))}>Remove</button>
                </div>
              );
            })}
          </div>
          <div className="meeting-form-actions"><span>Invites are limited to approved workspace accounts.</span><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create meeting"} <span aria-hidden="true">↗</span></button></div>
        </form>
      )}
    </section>
  );
}