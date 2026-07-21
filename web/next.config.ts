import type { NextConfig } from "next";
import path from "node:path";

// --- Content-Security-Policy (ENFORCED — security R3/#9) --------------------
// Pragmatic enforcement WITHOUT nonces: everything that cannot break the
// Next/Tailwind/font asset graph is enforced now; script-src/style-src keep
// 'unsafe-inline' because Next injects inline bootstrap scripts (hydration/
// streaming) that only a per-request nonce could lock down — that upgrade is
// a planned separate round (DEV-030, touches proxy.ts + forces dynamic
// rendering). What enforcement buys today:
//   • connect-src  — the browser refuses to send requests anywhere except
//     our own origin + Supabase: blocks the data-exfiltration channel of
//     injected code, the practical payoff of an XSS.
//   • frame-ancestors 'none' — no site can embed the app (clickjacking,
//     enforced alongside the legacy X-Frame-Options).
//   • form-action 'self' — no form can be submitted to a foreign origin.
//   • object-src 'none' / base-uri 'self' — legacy injection vectors closed.
// img-src includes data: for the provider-generated 2FA QR (data: URI <img>).
// The PDF viewer opens via window.open(blob:) — a top-level navigation, not
// subject to object-src/frame-src, so it keeps working.
// Environment branches (neither ever reaches Production):
//   • next dev needs 'unsafe-eval' (react-refresh) + ws: (HMR websocket).
//   • Vercel Preview gets the vercel.live toolbar allowances.
// NOTE for the attachments feature (migration 0031+): if file previews are
// rendered inline from Supabase Storage, add https://*.supabase.co to
// img-src at that point.
const isDevServer = process.env.NODE_ENV === "development";
const isVercelPreview = process.env.VERCEL_ENV === "preview";

const scriptSrc = ["'self'", "'unsafe-inline'"];
if (isDevServer) scriptSrc.push("'unsafe-eval'");
if (isVercelPreview) scriptSrc.push("https://vercel.live");

const styleSrc = ["'self'", "'unsafe-inline'"];
if (isVercelPreview) styleSrc.push("https://vercel.live");

const imgSrc = ["'self'", "data:"];
if (isVercelPreview) imgSrc.push("https://vercel.live", "https://vercel.com");

const fontSrc = ["'self'"];
if (isVercelPreview)
  fontSrc.push("https://vercel.live", "https://assets.vercel.com");

const connectSrc = ["'self'", "https://*.supabase.co"];
if (isDevServer) connectSrc.push("ws:");
if (isVercelPreview) connectSrc.push("https://vercel.live", "wss://*.pusher.com");

const frameSrc = isVercelPreview ? ["https://vercel.live"] : ["'none'"];

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  `style-src ${styleSrc.join(" ")}`,
  `img-src ${imgSrc.join(" ")}`,
  `font-src ${fontSrc.join(" ")}`,
  `connect-src ${connectSrc.join(" ")}`,
  `frame-src ${frameSrc.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Harmless on localhost (potentially-trustworthy origins are exempt from
  // upgrading), meaningful behind HTTPS: any stray http:// subresource is
  // auto-upgraded instead of loaded as mixed content.
  "upgrade-insecure-requests",
].join("; ");

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
        // Baseline security headers for every route. CSP graduated from
        // Report-Only to ENFORCED in security round R3 (#9) — the policy
        // string and its tradeoffs are documented above.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
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
