import type { Metadata } from "next";
import type { Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

const editorial = localFont({
  src: "./fonts/newsreader-regular.ttf",
  weight: "400",
  variable: "--font-editorial",
  display: "swap",
  fallback: ["Georgia"],
});
const body = localFont({
  src: [
    { path: "./fonts/instrument-sans-regular.ttf", weight: "400" },
    { path: "./fonts/instrument-sans-semibold.ttf", weight: "600" },
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["Arial"],
});

export const metadata: Metadata = {
  title: {
    default: "VERA Match — A meaningful connection",
    template: "%s | VERA Match",
  },
  description:
    "Private matchmaking with consent-controlled expert video reviews.",
};

export const viewport: Viewport = { themeColor: "#f5f3f8" };

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${editorial.variable} ${body.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
