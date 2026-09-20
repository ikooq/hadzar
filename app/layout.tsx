import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hadzar — time for two",
  description:
    "Find time together. Keep promises, save little notes, and stay close.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
  themeColor: "#E8ECEF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
