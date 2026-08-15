import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import UpdateDataButton from "@/components/UpdateDataButton";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Fantasy Sports Assistant",
  description: "Advanced analytics for your Dynasty and Redraft leagues",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="glass-header sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center">
                <Link href="/" className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xl shadow-[0_0_15px_rgba(37,99,235,0.5)]">
                    F
                  </div>
                  <span className="font-bold text-xl tracking-tight text-white hidden sm:block">
                    Fantasy Assistant
                  </span>
                </Link>

              </div>
              <div className="flex items-center gap-4">
                <UpdateDataButton />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
          {children}
        </main>
      </body>
    </html>
  );
}
