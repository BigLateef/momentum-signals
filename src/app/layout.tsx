import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Momentum Signals — Lateef's Alpha Terminal",
  description: "Invite-only momentum trading signal dashboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-base-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
