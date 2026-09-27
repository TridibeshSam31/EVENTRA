import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import SmoothScroll from "../components/SmoothScroll";

export const metadata: Metadata = {
  title: "EVENTRA — Adaptive Event Operations",
  description: "Plan the event. Run the event. Adapt when reality changes.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#ffffff" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <SmoothScroll>
          {children}
        </SmoothScroll>
      </body>
    </html>
  );
}
