"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  createWorkspaceUser,
  getCurrentUser,
  getErrorMessage,
  getWorkspaceUsers,
  removeWorkspaceUser,
  reviewWorkspaceUser,
  type User,
  type WorkspaceRole,
} from "@/lib/api";

type StatusFilter = "all" | User["approval_status"];

export default function AdminDashboardPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(async (currentUser) => {
        setCurrentUser(currentUser);
        if (currentUser.role !== "Workspace administrator") {
          setError("Administrator access is required to view account records.");
          return;
        }
        setUsers(await getWorkspaceUsers());
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

  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    const matchesStatus = statusFilter === "all" || user.approval_status === statusFilter;
    const matchesQuery = `${user.full_name} ${user.email} ${user.role}`.toLowerCase().includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });

  const counts = {
    all: users.length,
    pending: users.filter((user) => user.approval_status === "pending").length,
    approved: users.filter((user) => user.approval_status === "approved").length,
    rejected: users.filter((user) => user.approval_status === "rejected").length,
  };
  const showRoleColumn = statusFilter !== "pending";

  async function reviewUser(user: User, status: "approved" | "rejected") {
    setActionError("");
    setNotice("");
    setActionBusyId(user.id);
    try {
      const approvalRole = user.approval_status === "pending" ? "Meeting participant" : user.role as WorkspaceRole;
      const updated = await reviewWorkspaceUser(user.id, status, status === "approved" ? approvalRole : undefined);
      setUsers((currentUsers) => currentUsers.map((current) => current.id === user.id ? updated : current));
      setNotice(status === "approved" ? `${user.full_name} was approved.` : `${user.full_name} was rejected.`);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
      setActionBusyId(null);
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Remove ${user.full_name}'s account? This cannot be undone.`)) return;
    setActionError("");
    setActionBusyId(user.id);
    try {
      await removeWorkspaceUser(user.id);
      setUsers((currentUsers) => currentUsers.filter((current) => current.id !== user.id));
      setNotice(`${user.full_name}'s account was removed.`);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
      setActionBusyId(null);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    setCreating(true);
    const form = new FormData(event.currentTarget);
    try {
      const user = await createWorkspaceUser({
        full_name: String(form.get("full_name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        confirm_password: String(form.get("confirm_password") ?? ""),
      });
      setUsers((currentUsers) => [user, ...currentUsers]);
      setNotice(`Account created for ${user.full_name}.`);
      setShowCreateForm(false);
    } catch (caught) {
      setFormError(getErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="admin-page">
      <div className="admin-topline">
        <div>
          <div className="eyebrow">WORKSPACE ADMINISTRATION</div>
          <h1>Accounts</h1>
            <p>Review signup requests and manage workspace access.</p>
        </div>
        <div className="admin-heading-actions">
          <Link className="button button-quiet" href="/profile">Back to profile</Link>
          <Link className="button button-primary meeting-create-link" href="/meetings/new">Create meeting <span aria-hidden="true">↗</span></Link>
          <button className="button button-quiet" type="button" onClick={() => setShowCreateForm((open) => !open)}>
            {showCreateForm ? "Cancel" : "Add user"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="form-error admin-error" role="alert">{error}</p>
      ) : (
        <section className="accounts-section" aria-labelledby="accounts-heading">
          {notice && <p className="form-success" role="status">{notice}</p>}
          {actionError && <p className="form-error" role="alert">{actionError}</p>}
          {showCreateForm && (
            <form className="create-user-form" onSubmit={createUser}>
              <div className="create-user-heading"><div><h2>Create account</h2><p>Set an initial password for the new workspace user.</p></div></div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="create-user-fields">
                <div><label htmlFor="new-user-name">Full name</label><input id="new-user-name" name="full_name" autoComplete="name" maxLength={160} required /></div>
                <div><label htmlFor="new-user-email">Email address</label><input id="new-user-email" name="email" type="email" autoComplete="email" required /></div>
                <div><label htmlFor="new-user-password">Initial password</label><input id="new-user-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div>
                <div><label htmlFor="new-user-confirm-password">Confirm password</label><input id="new-user-confirm-password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div>
              </div>
              <div className="create-user-actions"><span>Share the initial password with the user securely.</span><button className="button button-primary" type="submit" disabled={creating}>{creating ? "Creating…" : "Create account"}</button></div>
            </form>
          )}
          <div className="accounts-toolbar">
            <div>
              <h2 id="accounts-heading">Account requests</h2>
              <p>{loading ? "Loading accounts…" : `${counts.pending} awaiting review`}</p>
            </div>
            <label className="user-search">
              <span className="sr-only">Search accounts</span>
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" type="search" />
            </label>
          </div>

          <div className="account-tabs" role="tablist" aria-label="Filter accounts by approval status">
            {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((filter) => (
              <button
                className={`account-tab${statusFilter === filter ? " account-tab-active" : ""}`}
                key={filter}
                type="button"
                role="tab"
                aria-selected={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
              >
                {filter === "approved" ? "Active" : filter === "all" ? "All accounts" : filter[0].toUpperCase() + filter.slice(1)}
                <span>{counts[filter]}</span>
              </button>
            ))}
          </div>

          <div className="user-table-wrap">
            <table className="user-table">
              <thead><tr><th scope="col">Account</th>{showRoleColumn && <th scope="col">Role</th>}<th scope="col">Approval</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td className="table-message" colSpan={showRoleColumn ? 4 : 3}>Loading account list…</td></tr>
                ) : visibleUsers.length === 0 ? (
                  <tr><td className="table-message" colSpan={showRoleColumn ? 4 : 3}>{normalizedQuery ? "No accounts match your search." : statusFilter === "pending" ? "There are no signup requests waiting for approval." : "No accounts in this view."}</td></tr>
                ) : visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td><span className="table-person"><span className="table-avatar">{user.full_name.slice(0, 1).toUpperCase()}</span><span><strong>{user.full_name}</strong><small>{user.email}</small></span></span></td>
                    {showRoleColumn && <td>{user.role}</td>}
                    <td><span className={`approval-badge approval-${user.approval_status}`}>{user.approval_status}</span></td>
                    <td>
                      <div className="account-row-actions">
                        {user.approval_status !== "approved" && (
                          <button className="text-action text-action-approve" type="button" disabled={actionBusyId === user.id} onClick={() => reviewUser(user, "approved")}>
                            {actionBusyId === user.id ? "Saving…" : "Approve"}
                          </button>
                        )}
                        {user.approval_status === "pending" && (
                          <button className="text-action text-action-reject" type="button" disabled={actionBusyId === user.id} onClick={() => reviewUser(user, "rejected")}>Reject</button>
                        )}
                        {user.id !== currentUser?.id && (
                          <button className="text-action text-action-reject" type="button" disabled={actionBusyId === user.id} onClick={() => removeUser(user)}>Remove</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && <p className="table-footnote">Showing {visibleUsers.length} of {users.length} accounts</p>}
        </section>
      )}
    </section>
  );
}