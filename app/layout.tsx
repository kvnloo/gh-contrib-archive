import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "kvnloo GitHub archive",
  description: "Public GitHub issues, PRs, and comments — private work is counted, not opened",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-sm sm:px-6">
            <Link href="/" className="font-medium">
              @kvnloo archive
            </Link>
            <div className="flex gap-4 text-zinc-400">
              <Link href="/" className="hover:text-zinc-100">
                Visualize
              </Link>
              <Link href="/sanity" className="hover:text-zinc-100">
                Sanity
              </Link>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
