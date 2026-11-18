"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deleteMeeting,
  getCurrentUser,
  getErrorMessage,
  getMeeting,
  getMeetingCallStatus,
  type Meeting,
  type MeetingCallStatus,
  type User,
} from "@/lib/api";

export default function MeetingDetailsPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = Number(params.meetingId);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [callStatus, setCallStatus] = useState<MeetingCallStatus | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!Number.isInteger(meetingId) || meetingId < 1) {
      setError("Meeting not found.");
      return;
    }
    Promise.all([getCurrentUser(), getMeeting(meetingId), getMeetingCallStatus(meetingId)])
      .then(([currentUser, currentMeeting, status]) => {
        setUser(currentUser);
        setMeeting(currentMeeting);
        setCallStatus(status);
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

  if (error) return <section className="meeting-form-page"><p className="form-error" role="alert">{error}</p><Link className="back-link" href="/meetings">← Back to meetings</Link></section>;
  if (!meeting) return <div className="profile-loading" role="status">Loading meeting…</div>;

  const userRole = meeting.participants.find((participant) => participant.id === user?.id)?.role;
  const canDelete = Boolean(
    user && (user.role === "Workspace administrator" || meeting.created_by_id === user.id || userRole === "Meeting organiser")
  );

  return (
    <section className="meeting-details-page">
      <div className="meeting-header-actions">
        <Link className="back-link" href="/meetings">← Meetings</Link>
        {canDelete && (
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
        if (userRole === "Meeting organiser") {
          return <Link className="button button-primary meeting-call-link" href={`/meetings/${meeting.id}/call`}>Start call <span aria-hidden="true">↗</span></Link>;
        }
        return null;
      })()}
      <div className="meeting-detail-grid">
        <section className="meeting-agenda-section"><h2>Agenda</h2><p>{meeting.agenda || "No agenda has been added."}</p></section>
        <section className="meeting-participants-section"><h2>People</h2><ul>{meeting.participants.map((participant) => (
          <li key={participant.id}><span className="table-avatar">{participant.full_name.slice(0, 1).toUpperCase()}</span><span><strong>{participant.full_name}</strong><small>{participant.email}</small></span><span className="table-role">{participant.role}</span></li>
        ))}</ul></section>
      </div>
    </section>
  );
}