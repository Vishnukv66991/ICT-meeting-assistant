"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/AuthFrame";
import { getErrorMessage, registerAccount } from "@/lib/api";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await registerAccount({
        full_name: String(form.get("full_name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        confirm_password: String(form.get("confirm_password") ?? ""),
      });
      setSubmitted(true);
    } catch (caught) {
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      variant="register"
      kicker="YOUR WORKSPACE STARTS HERE"
      title={<>Better meetings.<br /><em>Clear next steps.</em></>}
      description="Bring the conversation together, then leave with the decisions and actions that matter."
    >
      {submitted ? (
        <div className="signup-pending" role="status">
          <div className="eyebrow">REQUEST RECEIVED</div>
          <h2 id="form-title">Your account is awaiting approval</h2>
          <p className="form-intro">A workspace administrator must approve your account before you can sign in.</p>
          <p className="form-switch">Already approved? <Link href="/login">Sign in</Link></p>
        </div>
      ) : <>
      <h2 id="form-title">Create your account</h2>
      <p className="form-intro">Make space for your team&apos;s best thinking.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="full_name">Full name</label>
        <input id="full_name" name="full_name" autoComplete="name" placeholder="e.g. Alex Morgan" required maxLength={160} />
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        <div className="field-grid">
          <div><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" placeholder="8+ characters" minLength={8} required /></div>
          <div><label htmlFor="confirm_password">Confirm password</label><input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" placeholder="Repeat password" required /></div>
        </div>
        <p className="field-hint">Use at least 8 characters. Your password is stored securely.</p>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"} <span aria-hidden="true">↗</span></button>
      </form>
      <p className="form-switch">Already have an account? <Link href="/login">Sign in</Link></p>
      <p className="privacy-note"><span aria-hidden="true">◈</span> Your meetings stay within your workspace.</p>
      </>}
    </AuthFrame>
  );
}