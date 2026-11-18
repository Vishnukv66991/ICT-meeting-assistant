export type User = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  approval_status: "pending" | "approved" | "rejected";
};

export type WorkspaceRole =
  | "Workspace administrator"
  | "Meeting organiser"
  | "Meeting participant"
  | "Reviewer/editor";

export type MeetingRole = "Meeting organiser" | "Meeting participant" | "Reviewer/editor";

export type MeetingParticipant = {
  id: number;
  full_name: string;
  email: string;
  role: MeetingRole;
};

export type Meeting = {
  id: number;
  title: string;
  starts_at: string;
  agenda: string;
  created_by_id: number;
  created_at: string;
  participants: MeetingParticipant[];
};

export type MeetingCallStatus = {
  active: boolean;
  host_user_id: number | null;
  participant_count: number;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function readCsrfCookie() {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("gather_csrf="))
    ?.slice("gather_csrf=".length);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    let message = "Something went wrong. Please try again.";
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      message = detail.map((err) => (typeof err === "object" && err?.msg ? err.msg : JSON.stringify(err))).join(", ");
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function initializeCsrf() {
  await request<{ csrf_token: string }>("/api/auth/csrf");
}

async function csrfHeaders() {
  if (!readCsrfCookie()) await initializeCsrf();
  const token = readCsrfCookie();
  if (!token) throw new Error("Could not start a secure session. Refresh and try again.");
  return { "X-CSRF-Token": decodeURIComponent(token) };
}

export async function registerAccount(payload: {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
}) {
  return request<User>("/api/auth/register", {
    method: "POST",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function loginAccount(payload: { email: string; password: string; remember: boolean }) {
  return request<User>("/api/auth/login", {
    method: "POST",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export function getCurrentUser() {
  return request<User>("/api/auth/me");
}

export function getWorkspaceUsers() {
  return request<User[]>("/api/admin/users");
}

export function getMeetings() {
  return request<Meeting[]>("/api/meetings");
}

export function getMeeting(meetingId: number) {
  return request<Meeting>(`/api/meetings/${meetingId}`);
}

export async function deleteMeeting(meetingId: number) {
  return request<void>(`/api/meetings/${meetingId}`, {
    method: "DELETE",
    headers: await csrfHeaders(),
  });
}

export function getMeetingCallStatus(meetingId: number) {
  return request<MeetingCallStatus>(`/api/meetings/${meetingId}/call-status`);
}

export function getMeetingCallSocketUrl(meetingId: number) {
  const apiUrl = new URL(apiBase);
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${apiUrl.origin}/api/meetings/${meetingId}/call`;
}

export function getApprovedMembers() {
  return request<User[]>("/api/meetings/members");
}

export async function createMeeting(payload: {
  title: string;
  starts_at: string;
  agenda: string;
  participants: Array<{ user_id: number; role: MeetingRole }>;
}) {
  return request<Meeting>("/api/meetings", {
    method: "POST",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function addMeetingParticipant(
  meetingId: number,
  payload: { user_id: number; role: MeetingRole }
) {
  return request<Meeting>(`/api/meetings/${meetingId}/participants`, {
    method: "POST",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function removeMeetingParticipant(meetingId: number, userId: number) {
  return request<void>(`/api/meetings/${meetingId}/participants/${userId}`, {
    method: "DELETE",
    headers: await csrfHeaders(),
  });
}

export async function createWorkspaceUser(payload: {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
}) {
  return request<User>("/api/admin/users", {
    method: "POST",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reviewWorkspaceUser(userId: number, status: "approved" | "rejected", role?: WorkspaceRole) {
  return request<User>(`/api/admin/users/${userId}/approval`, {
    method: "PATCH",
    headers: await csrfHeaders(),
    body: JSON.stringify({ status, role }),
  });
}

export async function changeWorkspaceUserRole(userId: number, role: WorkspaceRole) {
  return request<User>(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: await csrfHeaders(),
    body: JSON.stringify({ role }),
  });
}

export async function removeWorkspaceUser(userId: number) {
  return request<void>(`/api/admin/users/${userId}`, {
    method: "DELETE",
    headers: await csrfHeaders(),
  });
}

export async function updateProfile(payload: { full_name: string; email: string }) {
  return request<User>("/api/auth/profile", {
    method: "PATCH",
    headers: await csrfHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function logoutAccount() {
  return request<void>("/api/auth/logout", { method: "POST", headers: await csrfHeaders() });
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}