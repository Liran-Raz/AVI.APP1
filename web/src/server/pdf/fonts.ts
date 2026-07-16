import "server-only";
import { Font } from "@react-pdf/renderer";

import { RUBIK_BOLD_B64, RUBIK_REGULAR_B64 } from "./fonts-data";

// Register the Hebrew font ONCE per server process. react-pdf's Font.register
// accepts a data-URI src, so the base64-embedded TTFs (fonts-data.ts) work
// with no filesystem/network access — reliable on Vercel serverless.

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: "Rubik",
    fonts: [
      { src: `data:font/ttf;base64,${RUBIK_REGULAR_B64}`, fontWeight: "normal" },
      { src: `data:font/ttf;base64,${RUBIK_BOLD_B64}`, fontWeight: "bold" },
    ],
  });
  // Hebrew has no hyphenation; returning the whole word avoids odd breaks.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export const PDF_FONT_FAMILY = "Rubik";
