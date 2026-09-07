import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { sitemapResponse, type SitemapEntry } from "@/lib/sitemap";

const BASE_URL = "https://freerun.lovable.app";

const ENTRIES: readonly SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => sitemapResponse(BASE_URL, ENTRIES),
    },
  },
});
