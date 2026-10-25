import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Microfin · A little clarity for your money",
  description:
    "Simple personal and small business finances, across currencies.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.classList.toggle('dark',localStorage.getItem('microfin-theme')==='dark'||(!localStorage.getItem('microfin-theme')&&matchMedia('(prefers-color-scheme: dark)').matches))}catch{}`,
          }}
        />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
