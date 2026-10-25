"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="auth-wrap">
      <div className="panel">
        <h1>Let’s try that again</h1>
        <p>Something interrupted this page. Your posted records are safe.</p>
        <button className="button" onClick={reset}>
          Reload page
        </button>
      </div>
    </main>
  );
}
