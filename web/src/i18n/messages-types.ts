import he from "./messages/he.json";

// he.json is the SOURCE OF TRUTH for the key set. `MessageKey` is derived
// from it, so `tsc` flags any `t("…")` call whose key doesn't exist and any
// key renamed/removed from the catalog. Every locale catalog must carry the
// same keys (enforced by the key-parity test).
//
// This module is consumed via `import type` only, so the he.json value is
// erased from client bundles — the active catalog reaches the client as a
// prop from the server, not bundled here.
export type MessageKey = keyof typeof he;

export type Messages = Record<MessageKey, string>;

// Values interpolated into a message via {placeholder} tokens.
export type MessageVars = Record<string, string | number>;

export type TFunction = (key: MessageKey, vars?: MessageVars) => string;

// Pure lookup + {var} interpolation. Shared by the client hook and the
// server helper so both render identically. Falls back to the key itself on
// a miss (visible in dev; the parity test prevents real gaps).
export function translate(
  messages: Messages,
  key: MessageKey,
  vars?: MessageVars,
): string {
  let out: string = messages[key] ?? key;
  if (vars) {
    for (const name of Object.keys(vars)) {
      out = out.replaceAll(`{${name}}`, String(vars[name]));
    }
  }
  return out;
}
