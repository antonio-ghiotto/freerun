/**
 * Typed sitemap generation helpers.
 *
 * Keeping the XML logic here (instead of inline in the route file) means the
 * route module only wires a plain `Request -> Response` handler, so a future
 * change cannot accidentally introduce unsupported route options (TS2353).
 */

export type ChangeFreq =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapEntry {
  /** Absolute path starting with "/". */
  path: `/${string}` | "/";
  changefreq?: ChangeFreq;
  /** 0.0 - 1.0 */
  priority?: number;
  lastmod?: Date;
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function buildSitemapXml(
  baseUrl: string,
  entries: readonly SitemapEntry[],
): string {
  const origin = baseUrl.replace(/\/$/, "");

  const urls = entries.map((entry) => {
    const lines = [
      "  <url>",
      `    <loc>${escapeXml(`${origin}${entry.path}`)}</loc>`,
      entry.lastmod
        ? `    <lastmod>${entry.lastmod.toISOString().slice(0, 10)}</lastmod>`
        : null,
      entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : null,
      entry.priority !== undefined
        ? `    <priority>${entry.priority.toFixed(1)}</priority>`
        : null,
      "  </url>",
    ];
    return lines.filter((line): line is string => line !== null).join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
  ].join("\n");
}

export function sitemapResponse(
  baseUrl: string,
  entries: readonly SitemapEntry[],
): Response {
  return new Response(buildSitemapXml(baseUrl, entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
