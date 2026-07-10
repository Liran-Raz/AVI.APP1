import "./marketing.css";

import { LandingGlass } from "@/components/marketing/LandingGlass";

// Marketing landing. Server Component: it only imports the route-scoped
// marketing.css (all selectors under `.mkt`, so nothing leaks into the app)
// and renders the interactive client landing. The page title/description live
// in the root layout's metadata.
export default function Home() {
  return <LandingGlass />;
}
