import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { NativeBridge } from "@/components/native/native-bridge";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/i18n/locale-provider";
import { dirFor } from "@/i18n/config";
import { loadMessages, getServerT } from "@/i18n/server";
import { readLocale } from "@/server/i18n/locale-cookie";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await readLocale());
  return {
    title: t("meta.title"),
    description: t("meta.description"),
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
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale drives <html lang/dir>, the message catalog, and the Toaster
  // direction. Read once on the server and injected into the client provider
  // as props → server and client agree on first paint (no hydration flash).
  const locale = await readLocale();
  const dir = dirFor(locale);
  const messages = await loadMessages(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${heebo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <LocaleProvider locale={locale} messages={messages}>
          <NativeBridge />
          {children}
          {/* Global toast host. Every toast() call in the app renders here —
              without a mounted Toaster, sonner toasts are silent no-ops. */}
          <Toaster position="top-center" dir={dir} />
        </LocaleProvider>
      </body>
    </html>
  );
}
