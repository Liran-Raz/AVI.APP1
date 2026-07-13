// Client-side helpers for detecting the Capacitor native shell.
//
// Detection reads the `Capacitor` global that the shell injects into the
// WebView — no @capacitor/core import, so this stays out of the SSR/web bundle
// graph and is safe to call anywhere (returns false server-side and on the web).

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the installed iOS/Android app (never on the web). */
export function isNativeApp(): boolean {
  return Boolean(capacitor()?.isNativePlatform?.());
}
