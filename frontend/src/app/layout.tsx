import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShadowChat — Zero-Knowledge Encrypted P2P File Sharing",
  description: "Fast, secure, peer-to-peer room-based communication and large file sharing platform. Fully client-side encrypted, zero-knowledge server.",
  icons: {
    icon: "/favicon.ico",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full scroll-smooth">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans min-h-full bg-bg-primary text-text-primary antialiased selection:bg-accent-primary/30 selection:text-white`}>
        {children}
      </body>
    </html>
  );
}
