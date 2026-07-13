import type { CapacitorConfig } from "@capacitor/cli";

/**
 * AVI.APP native shell — HOSTED mode.
 *
 * The WebView loads the live production site (server.url) rather than a
 * bundled build: the app is Next SSR + cookie auth on www.aviapp1.com, which
 * cannot be statically exported, so hosting remotely lets the shell inherit the
 * exact same app + session with zero duplication. The only cost is an
 * internet dependency, softened by the offline fallback in `webDir`.
 *
 * appId is permanent once published — see com.aviapp1.app (matches aviapp1.com).
 */
const config: CapacitorConfig = {
  appId: "com.aviapp1.app",
  appName: "AVI.APP",
  // Fallback bundle shown only if the remote site is unreachable (offline).
  webDir: "capacitor-fallback",
  backgroundColor: "#0d1c32", // navy — matches splash + sidebar, no white flash
  server: {
    url: "https://www.aviapp1.com",
    // Keep first-party navigation inside the WebView. Third-party auth
    // (Google) is opened in the system browser in M1-C, so it is intentionally
    // NOT listed here.
    allowNavigation: ["www.aviapp1.com", "aviapp1.com", "*.supabase.co"],
  },
  ios: {
    backgroundColor: "#0d1c32",
    // Let the web content draw under the status bar; our env(safe-area-inset-*)
    // CSS pads the sticky chrome clear of the notch + home indicator.
    contentInset: "never",
  },
  android: {
    backgroundColor: "#0d1c32",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0d1c32",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      // Light glyphs over the navy splash / login. Screens with a light top
      // (the authenticated glass topbar) can flip this at runtime later.
      style: "LIGHT",
      backgroundColor: "#0d1c32",
      overlaysWebView: true,
    },
  },
};

export default config;
