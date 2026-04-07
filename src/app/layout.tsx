import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Trending Engine — Times Internet Editorial Command Center",
  description:
    "Real-time trend intelligence dashboard powered by Google Trends, Twitter/X, and AI-driven article matching for the NBT editorial team.",
  keywords: [
    "trending",
    "news",
    "editorial",
    "Times Internet",
    "NBT",
    "Google Trends",
    "Twitter Trends",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-[#f8f9fa]">
      <body className={`${inter.variable} font-sans antialiased text-slate-800 selection:bg-blue-100 selection:text-blue-900`}>
        {children}
      </body>
    </html>
  );
}
