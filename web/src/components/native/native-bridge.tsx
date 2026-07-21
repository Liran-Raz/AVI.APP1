"use client";

import { useEffect } from "react";

import { isNativeApp } from "@/lib/native";
import { NATIVE_OAUTH_CALLBACK } from "@/lib/native-auth";
import { sanitizeNextPath } from "@/lib/safe-path";

/**
 * Deep-link bridge for the Capacitor native shell. Mounted app-wide (root
 * layout); renders nothing and does nothing on the web.
 *
 * Google refuses OAuth inside embedded WebViews, so the native Google flow runs
 * in the system browser (see login-form) and Supabase redirects back to
 * `com.aviapp1.app://auth/callback?code=…`. iOS/Android hand that URL to the app
 * via @capacitor/app's `appUrlOpen`. We then re-point the WebView — which holds
 * the PKCE verifier cookie — at the same-origin `/auth/callback`, where the
 * existing route exchanges the code for a session cookie in the right context.
 */
export function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", (event: { url: string }) => {
        void handleUrl(event.url);
      });
      if (cancelled) handle.remove();
      else remove = () => handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}

async function handleUrl(url: string): Promise<void> {
  // Only our OAuth return leg — ignore any other deep links.
  if (!url || !url.startsWith(NATIVE_OAUTH_CALLBACK)) return;

  // Dismiss the system browser sheet if it's still up.
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    // Best-effort — the sheet may already be gone.
  }

  let code: string | null = null;
  let next = "/tasks";
  try {
    const parsed = new URL(url);
    code = parsed.searchParams.get("code");
    // Defense-in-depth: sanitize here too, even though the server-built deep
    // link is already vetted and /auth/callback re-sanitizes at the sink — so
    // "every client-side redirect goes through sanitizeNextPath" holds uniformly.
    next = sanitizeNextPath(parsed.searchParams.get("next"), "/tasks");
  } catch {
    // Malformed deep link — fall through to the error redirect below.
  }

  if (!code) {
    window.location.assign("/login?error=auth_callback_failed");
    return;
  }

  // Same-origin (hosted) navigation → the WebView's /auth/callback finishes the
  // exchange. `next` is re-sanitized server-side by that route.
  const target =
    `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
  window.location.assign(target);
}
