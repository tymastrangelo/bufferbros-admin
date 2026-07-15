import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Splash } from "@/components/splash";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Buffer Bros", template: "%s — Buffer Bros" },
  description: "Buffer Bros operations dashboard",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Buffer Bros" },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans">
        <Splash />
        {children}
      </body>
    </html>
  );
}
