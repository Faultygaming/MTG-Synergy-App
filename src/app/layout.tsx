import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG Synergy Map",
  description:
    "Word-map style synergy explorer and deck builder for Magic: The Gathering.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-stone-200 antialiased">
        {children}
      </body>
    </html>
  );
}
