import "server-only";

import type { Locale } from "./config";
import {
  translate,
  type MessageKey,
  type Messages,
  type MessageVars,
} from "./messages-types";

// Server-side catalog loading. Dynamically imports ONE locale's catalog so
// only the active language is serialized into the RSC payload / used on the
// server. Static JSON imports are inlined at build time, so this is cheap.
export async function loadMessages(locale: Locale): Promise<Messages> {
  switch (locale) {
    case "en":
      return (await import("./messages/en.json")).default as Messages;
    case "he":
    default:
      return (await import("./messages/he.json")).default as Messages;
  }
}

// Tiny server-side translator for the handful of server-rendered strings
// (currently just the <html> metadata title/description). Not threaded
// through services — those return stable keys the client localizes.
export async function getServerT(
  locale: Locale,
): Promise<(key: MessageKey, vars?: MessageVars) => string> {
  const messages = await loadMessages(locale);
  return (key, vars) => translate(messages, key, vars);
}
