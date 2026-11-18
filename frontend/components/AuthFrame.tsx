import type { ReactNode } from "react";

type AuthFrameProps = {
  variant: "register" | "login";
  kicker: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
};

export function AuthFrame({ variant, kicker, title, description, children }: AuthFrameProps) {
  const isRegister = variant === "register";

  return (
    <section className="auth-layout">
      <aside className="brand-panel">
        <div className="panel-kicker"><span className="kicker-line" /> MAKE ROOM FOR THE WORK</div>
        <h1>{title}</h1>
        <p className="panel-copy">{description}</p>
        {isRegister ? <MeetingNote /> : <QuoteNote />}
        <div className="panel-caption"><span>01</span> FROM TALKING POINTS TO FOLLOW-THROUGHS</div>
      </aside>
      <section className="form-panel" aria-labelledby="form-title">
        <div className={`form-wrap${isRegister ? "" : " login-wrap"}`}>
          <div className="eyebrow">{kicker}</div>
          {children}
        </div>
      </section>
    </section>
  );
}

function MeetingNote() {
  return (
    <div className="meeting-note" aria-label="Example meeting summary">
      <div className="note-topline"><span className="live-dot" /> PRODUCT CHECK-IN <span className="note-date">TODAY · 10:30</span></div>
      <div className="note-rule" />
      <div className="note-heading">A little more clarity.</div>
      <div className="note-row"><span className="check-icon">✓</span><span>Share the research readout</span><b>01</b></div>
      <div className="note-row"><span className="check-icon">✓</span><span>Confirm next sprint scope</span><b>02</b></div>
      <div className="note-footer"><span>2 decisions captured</span><span>↗</span></div>
    </div>
  );
}

function QuoteNote() {
  return (
    <div className="quote-card">
      <div className="quote-mark">“</div>
      <blockquote>Good meetings don&apos;t end when everyone leaves the room.</blockquote>
      <div className="quote-byline"><span className="avatar-stack"><i>A</i><i>M</i><i>J</i></span><span>Keep the momentum going</span></div>
      <div className="quote-index">GATHER NOTES <span>— 01</span></div>
    </div>
  );
}