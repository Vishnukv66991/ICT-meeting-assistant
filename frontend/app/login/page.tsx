"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/AuthFrame";
import { getErrorMessage, loginAccount } from "@/lib/api";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await loginAccount({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        remember: form.get("remember") === "on",
      });
      window.location.assign("/profile");
    } catch (caught) {
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      variant="login"
      kicker="WELCOME BACK"
      title={<>Pick up where<br /><em>you left off.</em></>}
      description="Your team's conversations, decisions and next steps, all in one considered place."
    >
      <h2 id="form-title">Sign in to Gather</h2>
      <p className="form-intro">Good to have you back. Let&apos;s get to it.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
        <label className="remember-row"><input type="checkbox" name="remember" /> <span>Keep me signed in for 30 days</span></label>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span aria-hidden="true">↗</span></button>
      </form>
      <p className="form-switch">New to Gather? <Link href="/register">Create an account</Link></p>
      <p className="privacy-note"><span aria-hidden="true">◈</span> Your meetings stay within your workspace.</p>
    </AuthFrame>
  );
}