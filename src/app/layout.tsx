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
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
