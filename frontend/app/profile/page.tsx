"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getCurrentUser, getErrorMessage, logoutAccount, updateProfile, type User } from "@/lib/api";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => window.location.replace("/login"));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setNotice("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const updated = await updateProfile({
        full_name: String(form.get("full_name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
      });
      setUser(updated);
      setNotice("Profile updated.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await logoutAccount();
      window.location.assign("/login");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  if (!user) return <div className="profile-loading" role="status">Loading your profile…</div>;

  return (
    <section className="profile-page">
      <div className="profile-heading">
        <div><div className="eyebrow">ACCOUNT SETTINGS</div><h1>Your profile</h1><p>Manage your personal details and workspace identity.</p></div>
        <div className="profile-heading-actions">
          <Link className="button button-quiet" href="/meetings">Meetings</Link>
          {user.role === "Workspace administrator" && <Link className="button button-quiet" href="/admin">Manage users</Link>}
          <button className="button button-quiet" type="button" onClick={signOut}><span aria-hidden="true">↗</span> Sign out</button>
        </div>
      </div>
      <div className="profile-content">
        <aside className="profile-rail">
          <div className="profile-avatar">{user.full_name.slice(0, 1).toUpperCase()}</div>
          <strong>{user.full_name}</strong><span>{user.role}</span>
          <div className="rail-divider" />
          <div className="rail-link rail-link-active"><span aria-hidden="true">◉</span> Personal details</div>
          <div className="rail-foot"><span className="status-dot" /> Workspace member</div>
        </aside>
        <section className="profile-form-section">
          <div className="section-title"><div><h2>Personal details</h2><p>Update how you appear to your team.</p></div><span className="edit-indicator">EDITABLE</span></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          <form className="profile-form" onSubmit={save}>
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" autoComplete="name" defaultValue={user.full_name} maxLength={160} required />
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" defaultValue={user.email} required />
            <div className="role-field"><div><label>Assigned role</label><p>Your workspace administrator manages roles.</p></div><span className="role-value">{user.role}</span></div>
            <div className="profile-actions"><span>Changes apply to your account immediately.</span><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"} <span aria-hidden="true">↗</span></button></div>
          </form>
        </section>
      </div>
    </section>
  );
}