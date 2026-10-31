import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import ReloadWhenStale from "@/components/ReloadWhenStale";
import ScrollToTop from "@/components/ScrollToTop";
import TabBar from "@/components/TabBar";
import ThemeSwitch from "@/components/ThemeSwitch";
import UpdateDataButton from "@/components/UpdateDataButton";
import VersionFooter from "@/components/VersionFooter";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: "Fantasy Sports Assistant",
  description: "Advanced analytics for your Dynasty and Redraft leagues",
  appleWebApp: {
    capable: true,
    title: "Fantasy",
    // Not black-translucent: its white clock would vanish on the light header.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT sets data-theme before React hydrates.
    <html
      lang="de"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col pb-[calc(63px+env(safe-area-inset-bottom))] sm:pb-0">
        <header className="app-header sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4 h-14">
              <Link href="/" aria-label="Fantasy Assistant" className="flex items-center gap-2">
                <div className="display w-8 h-8 -skew-x-10 bg-highlight text-on-highlight flex items-center justify-center text-2xl">
                  F
                </div>
                <span className="display text-[22px] text-ink hidden lg:block">Fantasy Assistant</span>
              </Link>
              <TabBar placement="top" />
              <div className="ml-auto flex items-center gap-2">
                <ThemeSwitch />
                <UpdateDataButton />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
        <VersionFooter />
        <TabBar placement="bottom" />
        <ReloadWhenStale />
        <ScrollToTop />
      </body>
    </html>
  );
}
