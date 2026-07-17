import { describe, expect, it } from "vitest";

import he from "./he.json";
import en from "./en.json";

// Every locale catalog MUST carry the exact same key set as the source of
// truth (he.json). A missing/extra key in any locale ships a raw key string
// to a user — this guard turns that into a red test instead. Round 2 adds
// ru/de/fr/ja/it/ar imports here.
const CATALOGS: Record<string, Record<string, string>> = { he, en };

const heKeys = Object.keys(he).sort();

describe("i18n catalog key parity", () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    it(`${locale}.json has exactly the same keys as he.json`, () => {
      expect(Object.keys(catalog).sort()).toEqual(heKeys);
    });

    it(`${locale}.json has no empty values`, () => {
      const empty = Object.entries(catalog)
        .filter(([, v]) => typeof v !== "string" || v.trim() === "")
        .map(([k]) => k);
      expect(empty).toEqual([]);
    });
  }
});
