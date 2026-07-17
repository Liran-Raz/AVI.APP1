import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { NativeBridge } from "@/components/native/native-bridge";
import { Toaster } from "@/components/ui/sonner";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AVI.APP — ניהול משימות למשרדי רואי חשבון",
  description:
    "מערכת ניהול משימות פנים-ארגונית למשרדי רואי חשבון: תור משימות יומי, לוח שבועי, ניהול לקוחות.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  // appleWebApp settings make iOS treat the installed PWA like a
  // first-class app (no Safari chrome) and use the title we pick.
  appleWebApp: {
    title: "AVI.APP",
    statusBarStyle: "black-translucent",
    capable: true,
  },
};

export const viewport: Viewport = {
  // Status bar / address bar color on mobile. Navy matches the
  // installed-app sidebar background for a cohesive feel.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d1c32" },
    { media: "(prefers-color-scheme: dark)", color: "#0a121d" },
  ],
  width: "device-width",
  initialScale: 1,
  // Draw into the notch / home-indicator area so env(safe-area-inset-*)
  // resolves to real values inside the native shell (Capacitor) and
  // installed PWA. The sticky chrome then pads itself clear of both.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <NativeBridge />
        {children}
        {/* Global toast host. Every toast() call in the app renders here —
            without a mounted Toaster, sonner toasts are silent no-ops. */}
        <Toaster position="top-center" dir="rtl" />
      </body>
    </html>
  );
}
