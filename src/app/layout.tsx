import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aether - P2P File Radar",
  description: "Instant, private, peer-to-peer file sharing via decentralized radar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
