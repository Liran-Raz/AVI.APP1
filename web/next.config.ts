import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the Turbopack project root to this folder. Without this, Next.js can
  // walk up the parent directories and pick the wrong workspace root when
  // there's an unrelated project nearby — which leaks weird paths into source
  // maps and error stacks.
  turbopack: {
    root: path.join(__dirname),
  },
  // DO NOT add `outputFileTracingRoot` here. Previously set to
  // `path.join(__dirname)`, it caused Vercel production finalization to
  // fail with:
  //   ENOENT: '/vercel/path0/.next/routes-manifest-deterministic.json'
  // Vercel's pipeline resolved `.next` from the wrong root when this was
  // pinned. Removed in PR #4 (cd3fd24). Local dev / build worked either
  // way — the regression only manifests in Vercel. If you ever need to
  // re-add it, redeploy to Vercel and verify the production build first.
  async headers() {
    return [
      {
        // Baseline security headers for every route. nosniff + DENY +
        // Permissions-Policy are safe to enforce immediately. CSP is
        // Report-Only for now so it cannot break the Next/Tailwind/font
        // asset graph — violations are observed (browser console) before a
        // future enforcing policy is tuned and turned on.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' https://*.supabase.co",
          },
        ],
      },
      {
        // The invite pages carry the secret invite token in the query
        // string (?token=...). no-referrer guarantees the full URL is
        // never sent as a Referer to any destination — modern browser
        // defaults already strip the query cross-origin, but the pages
        // must not depend on client defaults for that.
        source: "/invite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
