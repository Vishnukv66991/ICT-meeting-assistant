"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getCurrentUser, getErrorMessage, getMeetings, type Meeting, type User } from "@/lib/api";

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCurrentUser(), getMeetings()])
      .then(([currentUser, currentMeetings]) => {
        setUser(currentUser);
        setMeetings(currentMeetings);
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

  return (
    <section className="meetings-page">
      <div className="meetings-heading">
        <div><div className="eyebrow">YOUR WORKSPACE</div><h1>Meetings</h1><p>Spaces you organize or have been invited to.</p></div>
        <div className="meetings-heading-actions">
          <Link className="button button-quiet" href="/profile"><span aria-hidden="true">←</span> Back to profile</Link>
          {user?.role === "Workspace administrator" && <Link className="button button-primary meeting-create-link" href="/meetings/new">Create meeting <span aria-hidden="true">↗</span></Link>}
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="meeting-empty">Loading meetings…</p> : meetings.length === 0 ? (
        <div className="meeting-empty"><strong>No meetings yet</strong><span>When you’re invited to a meeting, it will appear here.</span></div>
      ) : (
        <div className="meeting-list">
          {meetings.map((meeting) => (
            <Link className="meeting-list-row" href={`/meetings/${meeting.id}`} key={meeting.id}>
              <span className="meeting-date-block">
                <strong>{new Date(meeting.starts_at).toLocaleDateString(undefined, { day: "2-digit" })}</strong>
                <span>{new Date(meeting.starts_at).toLocaleDateString(undefined, { month: "short" })}</span>
              </span>
              <span className="meeting-row-main"><strong>{meeting.title}</strong><span>{new Date(meeting.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></span>
              <span className="meeting-row-meta">{meeting.participants.length} {meeting.participants.length === 1 ? "person" : "people"}</span>
              <span className="meeting-row-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}