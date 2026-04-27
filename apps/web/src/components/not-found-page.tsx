import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      minHeight: "60vh",
      padding: "2rem",
    }}>
      <h1 style={{ fontSize: "4rem", fontWeight: 700, marginBottom: "0.5rem", opacity: 0.3 }}>
        404
      </h1>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Page not found
      </h2>
      <p style={{ color: "var(--color-muted-foreground, #666)", marginBottom: "2rem", textAlign: "center" }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to="/"
        style={{
          padding: "0.5rem 1.5rem",
          border: "1px solid var(--color-border, #ccc)",
          borderRadius: "0.5rem",
          textDecoration: "none",
          color: "inherit",
          fontSize: "0.9rem",
          transition: "background 0.15s",
        }}
      >
        Go home
      </Link>
    </div>
  );
}
