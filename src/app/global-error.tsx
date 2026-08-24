"use client";

import type { CSSProperties } from "react";

const bodyStyle: CSSProperties = {
  minHeight: "100vh",
  margin: 0,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "#f3f6fa",
  color: "#101828",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
};

const panelStyle: CSSProperties = {
  width: "min(620px, 100%)",
  padding: 24,
  border: "1px solid #d92d20",
  borderRadius: 12,
  background: "#fff4f2",
  boxSizing: "border-box",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: "#b42318",
  fontSize: 12,
  fontWeight: 700,
};

const headingStyle: CSSProperties = { margin: "8px 0 0", fontSize: 24 };
const messageStyle: CSSProperties = { margin: "10px 0 18px", maxWidth: "58ch", lineHeight: 1.6 };
const retryButtonStyle: CSSProperties = {
  minHeight: 42,
  padding: "9px 16px",
  border: 0,
  borderRadius: 8,
  background: "#075985",
  color: "white",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
};

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={bodyStyle}>
        <main role="alert" style={panelStyle}>
          <p style={eyebrowStyle}>AGENCYOS ERROR</p>
          <h1 style={headingStyle}>Something went wrong</h1>
          <p style={messageStyle}>
            AgencyOS could not finish loading this page. Retry once. If the problem continues,
            contact your administrator with the time it occurred.
          </p>
          <button type="button" onClick={reset} style={retryButtonStyle}>
            Retry page
          </button>
        </main>
      </body>
    </html>
  );
}
