"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="loading-page" role="alert">
      <span className="brand-mark">
        <span className="mark" aria-hidden="true"><i /><i /></span>
        <span className="brand">hadzar</span>
      </span>
      <h1>Something interrupted your shared space.</h1>
      <p className="muted">Try again. Your saved data remains protected.</p>
      <button className="btn dark" onClick={reset}>Try again</button>
    </main>
  );
}
