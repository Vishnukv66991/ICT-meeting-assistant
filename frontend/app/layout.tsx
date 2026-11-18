import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gather | ICT AI Meeting Assistant",
  description: "AI-assisted meeting summaries and action items.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="wordmark" href="/" aria-label="Gather home">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>gather<span className="wordmark-period">.</span></span>
          </Link>
          <div className="topbar-note"><span className="status-dot" /> Meeting workspace <span className="prototype-label">PROTOTYPE</span></div>
        </header>
        <main>{children}</main>
        <footer className="site-footer"><span>Thoughtful meetings start here.</span><span>ICT AI Meeting Assistant · MVP</span></footer>
      </body>
    </html>
  );
}