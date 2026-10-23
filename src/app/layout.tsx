import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-oswald",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Facha Style · Barbería urbana", template: "%s · Facha Style" },
  description: "Reserva tu hora en segundos, sin crear cuenta.",
};

export const viewport: Viewport = { themeColor: "#0c0c0d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${oswald.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
