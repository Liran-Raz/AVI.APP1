// Shared, dependency-free constants for the native (Capacitor) OAuth bridge.
// Imported by BOTH server (auth.service builds the redirect) and client
// (login-form opens the system browser; native-bridge catches the return),
// so this file must stay a pure module — no window, no server-only, no deps.
//
// Google refuses OAuth inside embedded WebViews (`disallowed_useragent`), so in
// the native app the flow runs in the system browser and Supabase redirects
// back to this custom-scheme deep link. The app then re-points the WebView (which
// holds the PKCE verifier cookie) at the same-origin /auth/callback to finish
// the code-for-session exchange. Email/password is unaffected — it works in-WebView.
export const NATIVE_APP_SCHEME = "com.aviapp1.app";

// The full deep link Supabase returns to after Google auth. Must be added to
// Supabase → Auth → URL Configuration → Redirect URLs for the native flow to work.
export const NATIVE_OAUTH_CALLBACK = `${NATIVE_APP_SCHEME}://auth/callback`;
