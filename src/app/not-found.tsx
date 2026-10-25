import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="auth-wrap">
      <div className="panel">
        <h1>That page is missing</h1>
        <Link href="/">Back to your finances</Link>
      </div>
    </main>
  );
}
