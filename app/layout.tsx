import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800">
          <nav className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6 sm:py-3">
            <Link href="/" className="flex min-h-11 items-center font-medium">
              <span className="sm:hidden">@kvnloo</span>
              <span className="hidden sm:inline">@kvnloo archive</span>
            </Link>
            <div className="flex items-center gap-1 text-zinc-400 sm:gap-2">
              <Link href="/worlds" className="flex min-h-11 items-center rounded-full px-3 hover:bg-zinc-900 hover:text-zinc-100">
                Worlds
              </Link>
              <Link href="/sanity" className="flex min-h-11 items-center rounded-full px-3 hover:bg-zinc-900 hover:text-zinc-100">
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
