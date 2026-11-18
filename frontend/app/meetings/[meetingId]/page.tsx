"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  addMeetingParticipant,
  deleteMeeting,
  getApprovedMembers,
  getCurrentUser,
  getErrorMessage,
  getMeeting,
  getMeetingCallStatus,
  removeMeetingParticipant,
  type Meeting,
  type MeetingCallStatus,
  type MeetingRole,
  type User,
} from "@/lib/api";

const meetingRoles: MeetingRole[] = ["Meeting participant", "Reviewer/editor", "Meeting organiser"];

export default function MeetingDetailsPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = Number(params.meetingId);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [callStatus, setCallStatus] = useState<MeetingCallStatus | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<MeetingRole>("Meeting participant");
  const [addingPerson, setAddingPerson] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!Number.isInteger(meetingId) || meetingId < 1) {
      setError("Meeting not found.");
      return;
    }
    Promise.all([
      getCurrentUser(),
      getMeeting(meetingId),
      getMeetingCallStatus(meetingId),
      getApprovedMembers().catch(() => [] as User[]),
    ])
      .then(([currentUser, currentMeeting, status, members]) => {
        setUser(currentUser);
        setMeeting(currentMeeting);
        setCallStatus(status);
        setWorkspaceMembers(members);
      })
      .catch((caught: unknown) => setError(getErrorMessage(caught)));
  }, [meetingId]);

  async function handleDelete() {
    if (!meeting) return;
    if (!window.confirm(`Are you sure you want to delete "${meeting.title}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setActionError("");
    try {
      await deleteMeeting(meeting.id);
      window.location.assign("/meetings");
    } catch (caught: unknown) {
      setActionError(getErrorMessage(caught));
      setDeleting(false);
    }
  }

  async function handleAddPerson(e: FormEvent) {
    e.preventDefault();
    if (!meeting || !selectedUserId) return;
    setAddingPerson(true);
    setActionError("");
    try {
      const updatedMeeting = await addMeetingParticipant(meeting.id, {
        user_id: Number(selectedUserId),
        role: selectedRole,
      });
      setMeeting(updatedMeeting);
      setSelectedUserId("");
    } catch (caught: unknown) {
      setActionError(getErrorMessage(caught));
    } finally {
      setAddingPerson(false);
    }
  }

  async function handleRemovePerson(participantId: number) {
    if (!meeting) return;
    setActionError("");
    try {
      await removeMeetingParticipant(meeting.id, participantId);
      setMeeting({
        ...meeting,
        participants: meeting.participants.filter((p) => p.id !== participantId),
      });
    } catch (caught: unknown) {
      setActionError(getErrorMessage(caught));
    }
  }

  if (error) return <section className="meeting-form-page"><p className="form-error" role="alert">{error}</p><Link className="back-link" href="/meetings">← Back to meetings</Link></section>;
  if (!meeting) return <div className="profile-loading" role="status">Loading meeting…</div>;

  const userRole = meeting.participants.find((participant) => participant.id === user?.id)?.role;
  const isOrganiser = userRole === "Meeting organiser";
  const isCreator = meeting.created_by_id === user?.id;
  const isAdmin = user?.role === "Workspace administrator";
  const canManage = Boolean(user && (isAdmin || isCreator || isOrganiser));

  const existingParticipantIds = new Set(meeting.participants.map((p) => p.id));
  const availableUsersToAdd = workspaceMembers.filter((m) => !existingParticipantIds.has(m.id));

  return (
    <section className="meeting-details-page">
      <div className="meeting-header-actions">
        <Link className="back-link" href="/meetings">← Meetings</Link>
        {canManage && (
          <button
            className="button button-danger"
            type="button"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete meeting"}
          </button>
        )}
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      <div className="eyebrow">MEETING SPACE</div>
      <h1>{meeting.title}</h1>
      <p className="meeting-detail-time">{new Date(meeting.starts_at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</p>
      {callStatus && user && (() => {
        if (callStatus.active) {
          return <Link className="button button-primary meeting-call-link" href={`/meetings/${meeting.id}/call`}>
            {callStatus.host_user_id === user.id ? "Rejoin call" : "Join call"} <span aria-hidden="true">↗</span>
          </Link>;
        }
        if (isOrganiser || isAdmin) {
          return <Link className="button button-primary meeting-call-link" href={`/meetings/${meeting.id}/call`}>Start call <span aria-hidden="true">↗</span></Link>;
        }
        return null;
      })()}
      <div className="meeting-detail-grid">
        <section className="meeting-agenda-section"><h2>Agenda</h2><p>{meeting.agenda || "No agenda has been added."}</p></section>
        <section className="meeting-participants-section">
          <h2>People</h2>
          <ul>{meeting.participants.map((participant) => (
            <li key={participant.id}>
              <span className="table-avatar">{participant.full_name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{participant.full_name}</strong><small>{participant.email}</small></span>
              <span className="table-role">{participant.role}</span>
              {canManage && participant.id !== meeting.created_by_id && (
                <button
                  className="participant-remove-btn"
                  type="button"
                  title="Remove from meeting"
                  onClick={() => handleRemovePerson(participant.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}</ul>

          {canManage && availableUsersToAdd.length > 0 && (
            <form className="add-participant-form" onSubmit={handleAddPerson}>
              <div className="add-participant-heading">Add teammate to meeting</div>
              <div className="add-participant-row">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                >
                  <option value="">Select teammate…</option>
                  {availableUsersToAdd.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name} ({member.email})
                    </option>
                  ))}
                </select>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as MeetingRole)}
                >
                  {meetingRoles.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                <button
                  className="button button-quiet"
                  type="submit"
                  disabled={addingPerson || !selectedUserId}
                >
                  {addingPerson ? "Adding…" : "Add person"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}