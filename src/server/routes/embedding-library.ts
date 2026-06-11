import { Router } from "express";
import type { Request, Response } from "express";
import archiver from "archiver";
import * as fs from "fs";
import * as path from "path";
import {
  computeKeywordGroups,
  computeKeywordTags,
  filterLiteraturesByKeywords,
  getPaperKeywords,
  manualMergeKeywords,
  paginateKeywordTags,
  summarizeEmbeddingLibrary,
  toLiteraturePreview,
  type KeywordFilterOptions,
  type LiteratureRecord,
  type OuterTagsConfig,
} from "../../literature/keyword-library";
import { getLibraryFavoriteSet, toggleLibraryFavorite } from "../../utils/library-favorites";
import { logger } from "../../utils/logger";

export const EMBEDDING_LIBRARY_PAGE_SIZE = 100;
export const BUILT_IN_OA_DOWNLOAD_SOURCE_LABEL =
  "内置开放获取下载器：Semantic Scholar -> CORE API -> OpenAlex -> PubMed/NCBI E-utilities -> Crossref -> Unpaywall -> Europe PMC/PMC";

type PaperDownloadResult = {
  doi: string;
  status: "downloaded" | "linked" | "failed";
  buffer?: Buffer;
  filename?: string;
  link?: string;
  source?: string;
  message?: string;
};

type BrowserDownloadLike = {
  path(): Promise<string | null>;
  suggestedFilename(): string;
};

type BrowserPageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<{ url(): string; headers(): Record<string, string> } | null>;
  url(): string;
  evaluate(expression: string): Promise<unknown>;
  locator(selector: string, options?: Record<string, unknown>): {
    count(): Promise<number>;
    first(): { click(options?: Record<string, unknown>): Promise<void> };
  };
  waitForEvent(event: string, options?: Record<string, unknown>): Promise<BrowserDownloadLike>;
};

type BrowserContextLike = {
  cookies(urls?: string | string[]): Promise<Array<{ name: string; value: string }>>;
  newPage(): Promise<BrowserPageLike>;
};

type BrowserLike = {
  close(): Promise<void>;
  newContext(options: Record<string, unknown>): Promise<BrowserContextLike>;
};

export interface EmbeddingLibraryRoutesOptions {
  readUserLiteratureRecords(userId: string): LiteratureRecord[];
  loadOuterTagsConfigForUser(userId: string): OuterTagsConfig;
  saveOuterTagsConfigForUser(userId: string, config: OuterTagsConfig): OuterTagsConfig;
  refreshOuterTagCounts(papers: LiteratureRecord[], config: OuterTagsConfig): OuterTagsConfig;
  pageSize?: number;
}

export function parsePageNumber(value: unknown, defaultValue: number, maxValue: number): number {
  const parsed = Math.floor(Number(value ?? defaultValue));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

export function getLiteratureRecordKey(paper: LiteratureRecord): string {
  return String(paper.id || paper.doi || paper.title || "").trim();
}

export function paginateLiteratureRecords(
  papers: LiteratureRecord[],
  offset: number,
  limit: number
): {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  papers: ReturnType<typeof toLiteraturePreview>[];
} {
  const page = papers.slice(offset, offset + limit);
  return {
    total: papers.length,
    offset,
    limit,
    hasMore: offset + page.length < papers.length,
    papers: page.map(toLiteraturePreview),
  };
}

function withEmbeddingFavoriteFlags<T extends { id: string }>(items: T[], favoriteIds: Set<string>): Array<T & { favorite: boolean }> {
  return items.map(item => ({
    ...item,
    favorite: favoriteIds.has(item.id),
  }));
}

export function findLiteratureRecord(papers: LiteratureRecord[], key: string): LiteratureRecord | undefined {
  return papers.find(paper => getLiteratureRecordKey(paper) === key);
}

function userVisiblePapers(options: EmbeddingLibraryRoutesOptions, userId: string): LiteratureRecord[] {
  return options.readUserLiteratureRecords(userId).filter(paper => !paper.isPdf);
}

function normalizeDoi(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/[)\].,;，。；\s]+$/g, "")
    .trim();
}

function sanitizeZipName(value: string): string {
  return String(value || "paper")
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "paper";
}

function getPaperDisplayTitle(paper: LiteratureRecord): string {
  return String(paper.title || paper.doi || paper.id || "paper").trim();
}

export function parseDownloadConcurrency(value: unknown, defaultValue = 4): number {
  const parsed = Math.floor(Number(value ?? defaultValue));
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.max(1, Math.min(8, parsed));
}

export async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function extractDownloadUrlFromJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const directKeys = ["pdfUrl", "pdf_url", "downloadUrl", "download_url", "url", "fileUrl", "file_url"];
  for (const key of directKeys) {
    const found = record[key];
    if (typeof found === "string" && /^https?:\/\//i.test(found)) return found;
  }
  const nestedKeys = ["data", "result", "paper", "openAccessPdf", "best_oa_location", "oa_location"];
  for (const key of nestedKeys) {
    const found = extractDownloadUrlFromJson(record[key]);
    if (found) return found;
  }
  return "";
}

function extractBase64PdfFromJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["pdfBase64", "pdf_base64", "base64", "content", "file"]) {
    const found = record[key];
    if (typeof found === "string" && found.length > 100) {
      return found.replace(/^data:application\/pdf;base64,/i, "");
    }
  }
  return "";
}

async function responseToBuffer(response: globalThis.Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

async function fetchPdfByUrl(url: string, apiKey: string, extraHeaders: Record<string, string> = {}): Promise<{ buffer?: Buffer; contentType: string; error?: string }> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,application/octet-stream,*/*",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
  });
  if (!response.ok) {
    return { contentType: "", error: `HTTP ${response.status}` };
  }
  const contentType = response.headers.get("content-type") || "";
  const buffer = await responseToBuffer(response);
  if (!/application\/pdf|application\/octet-stream/i.test(contentType) && !buffer.subarray(0, 5).toString("utf-8").startsWith("%PDF")) {
    return { contentType, error: `not a PDF (${contentType || "unknown content-type"})` };
  }
  return { buffer, contentType };
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...headers,
      },
    });
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function collectOaPdfUrls(value: unknown, urls: string[] = []): string[] {
  if (!value) return urls;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && (/\.pdf(?:[?#].*)?$/i.test(value) || /pdf|\/download\/?|fulltext|pmc\/articles/i.test(value))) {
      urls.push(value);
    }
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectOaPdfUrls(item, urls));
    return urls;
  }
  if (typeof value !== "object") return urls;
  const record = value as Record<string, unknown>;
  const contentType = String(record["content-type"] || record.contentType || "").toLowerCase();
  if (contentType.includes("pdf")) {
    for (const key of ["url", "URL", "downloadUrl", "download_url", "fileUrl", "file_url"]) {
      const found = record[key];
      if (typeof found === "string" && /^https?:\/\//i.test(found)) urls.push(found);
    }
  }
  for (const key of ["url_for_pdf", "pdf_url", "pdfUrl", "url", "URL", "downloadUrl", "download_url", "fileUrl", "file_url", "fullTextIdentifier"]) {
    collectOaPdfUrls(record[key], urls);
  }
  for (const key of [
    "best_oa_location",
    "openAccessPdf",
    "primary_location",
    "locations",
    "oa_locations",
    "fullTextUrlList",
    "fullTextUrl",
    "sourceFulltextUrls",
    "links",
    "link",
    "message",
    "results",
    "items",
  ]) {
    collectOaPdfUrls(record[key], urls);
  }
  return urls;
}

function appendQuery(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function getNcbiParams(): Record<string, string> {
  return {
    tool: process.env.NCBI_TOOL || "scholar-harness",
    email: process.env.NCBI_EMAIL || process.env.PAPER_DOWNLOAD_EMAIL || process.env.UNPAYWALL_EMAIL || "support@scholarharness.com",
    api_key: process.env.NCBI_API_KEY || "",
  };
}

function getOpenclawDir(): string {
  const candidates = [
    process.env.OPENCLAW_DIR,
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      ? path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || "", "openclaw")
      : "",
    path.join(process.cwd(), "openclaw"),
    path.resolve(__dirname, "..", "..", "..", "openclaw"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return path.join(process.cwd(), "openclaw");
}

function loadOpenclawChromium(): unknown {
  const openclawDir = getOpenclawDir();
  const packagedBrowsersPath = path.join(openclawDir, "browsers");
  if (fs.existsSync(packagedBrowsersPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsersPath;
  }
  const playwrightPath = path.join(openclawDir, "node_modules", "playwright");
  if (!fs.existsSync(playwrightPath)) {
    throw new Error("未找到 OpenClaw/Playwright 组件，无法执行机构网络下载");
  }
  const playwright = require(playwrightPath) as { chromium?: unknown };
  if (!playwright.chromium) {
    throw new Error("OpenClaw/Playwright Chromium 不可用");
  }
  return playwright.chromium;
}

async function buildBrowserCookieHeader(context: { cookies(urls?: string | string[]): Promise<Array<{ name: string; value: string }>> }, url: string): Promise<string> {
  const cookies = await context.cookies(url);
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function collectInstitutionalPdfCandidates(value: unknown, baseUrl: string): Array<{ url: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const candidates: Array<{ url: string; label: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawUrl = String(record.url || "").trim();
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl, baseUrl).toString();
      const label = String(record.text || record.label || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (!/pdf|download|full\s*text|全文|下载/i.test(`${url} ${label}`)) continue;
      if (candidates.some(candidate => candidate.url === url)) continue;
      candidates.push({ url, label });
    } catch {
      // ignore malformed links from publisher pages
    }
  }
  return candidates.slice(0, 12);
}

async function tryDownloadViaBrowserCookies(
  url: string,
  context: { cookies(urls?: string | string[]): Promise<Array<{ name: string; value: string }>> },
  userAgent: string
): Promise<{ buffer?: Buffer; error?: string }> {
  const cookieHeader = await buildBrowserCookieHeader(context, url);
  const fetched = await fetchPdfByUrl(url, "", {
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  });
  if (fetched.buffer) return { buffer: fetched.buffer };
  return { error: fetched.error || "not a PDF" };
}

async function getOpenAccessPdfCandidates(doi: string): Promise<Array<{ source: string; url: string }>> {
  const normalizedDoi = normalizeDoi(doi);
  const candidates: Array<{ source: string; url: string }> = [];
  const add = (source: string, urls: string[]) => {
    for (const url of urls) {
      if (!url || candidates.some(item => item.url === url)) continue;
      candidates.push({ source, url });
    }
  };

  const semanticScholar = await fetchJson(
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(normalizedDoi)}?fields=title,openAccessPdf,externalIds`
  );
  add("Semantic Scholar", collectOaPdfUrls(semanticScholar));

  const coreApiKey = String(process.env.CORE_API_KEY || "").trim();
  const core = await fetchJson(
    `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(`doi:"${normalizedDoi}"`)}&limit=5`,
    coreApiKey ? { Authorization: `Bearer ${coreApiKey}` } : {}
  );
  add("CORE API", collectOaPdfUrls(core));

  const openAlex = await fetchJson(
    `https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${normalizedDoi}`)}`
  );
  add("OpenAlex", collectOaPdfUrls(openAlex));

  const ncbiParams = getNcbiParams();
  const idConverter = await fetchJson(
    appendQuery("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/", {
      ids: normalizedDoi,
      format: "json",
      email: ncbiParams.email,
      tool: ncbiParams.tool,
    })
  );
  const idConverterRecords = Array.isArray(idConverter?.records) ? idConverter.records as Array<Record<string, unknown>> : [];
  for (const record of idConverterRecords) {
    const pmcid = String(record.pmcid || record.pmcId || "").trim();
    if (pmcid) {
      add("PubMed/NCBI ID Converter", [`https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(pmcid)}/pdf/`]);
    }
  }

  const ncbiSearch = await fetchJson(
    appendQuery("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
      ...ncbiParams,
      db: "pubmed",
      term: `${normalizedDoi}[AID]`,
      retmode: "json",
      retmax: "5",
    })
  );
  const pubmedIds = ((((ncbiSearch?.esearchresult as Record<string, unknown> | undefined)?.idlist as unknown[]) || [])
    .map(id => String(id || "").trim())
    .filter(Boolean));
  for (const pubmedId of pubmedIds) {
    const ncbiLinks = await fetchJson(
      appendQuery("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi", {
        ...ncbiParams,
        dbfrom: "pubmed",
        db: "pmc",
        id: pubmedId,
        retmode: "json",
      })
    );
    const linksets = Array.isArray(ncbiLinks?.linksets) ? ncbiLinks.linksets as Array<Record<string, unknown>> : [];
    for (const linkset of linksets) {
      const linksetDbs = Array.isArray(linkset.linksetdbs) ? linkset.linksetdbs as Array<Record<string, unknown>> : [];
      for (const linksetDb of linksetDbs) {
        const links = Array.isArray(linksetDb.links) ? linksetDb.links : [];
        for (const link of links) {
          const pmcId = String(link || "").trim();
          if (!pmcId) continue;
          add("PubMed/NCBI E-utilities", [
            `https://pmc.ncbi.nlm.nih.gov/articles/${pmcId.startsWith("PMC") ? encodeURIComponent(pmcId) : `PMC${encodeURIComponent(pmcId)}`}/pdf/`,
          ]);
        }
      }
    }
  }

  const crossref = await fetchJson(
    `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`
  );
  add("Crossref", collectOaPdfUrls(crossref));

  const unpaywallEmail = String(process.env.UNPAYWALL_EMAIL || process.env.PAPER_DOWNLOAD_EMAIL || "support@scholarharness.com").trim();
  const unpaywall = await fetchJson(
    `https://api.unpaywall.org/v2/${encodeURIComponent(normalizedDoi)}?email=${encodeURIComponent(unpaywallEmail)}`
  );
  add("Unpaywall", collectOaPdfUrls(unpaywall));

  const europePmc = await fetchJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${normalizedDoi}"`)}&format=json&pageSize=1`
  );
  add("Europe PMC", collectOaPdfUrls(europePmc));
  const firstResult = (((europePmc?.resultList as Record<string, unknown> | undefined)?.result as unknown[]) || [])[0] as Record<string, unknown> | undefined;
  const pmcid = String(firstResult?.pmcid || firstResult?.pmcId || "").trim();
  if (pmcid) {
    add("PubMed Central", [
      `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(pmcid)}/pdf/`,
    ]);
  }

  return candidates;
}

export async function downloadOpenAccessPaperByDoi(
  doi: string,
  paper: Partial<LiteratureRecord> = {}
): Promise<PaperDownloadResult> {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    return { doi: "", status: "failed", message: "DOI 为空" };
  }

  const candidates = await getOpenAccessPdfCandidates(normalizedDoi);
  const errors: string[] = [];
  for (const candidate of candidates) {
    const fetched = await fetchPdfByUrl(candidate.url, "");
    if (fetched.buffer) {
      return {
        doi: normalizedDoi,
        status: "downloaded",
        buffer: fetched.buffer,
        filename: `${sanitizeZipName(normalizedDoi.replace(/\//g, "_"))}.pdf`,
        link: candidate.url,
        source: candidate.source,
        message: `${candidate.source}: downloaded ${fetched.buffer.length} bytes`,
      };
    }
    errors.push(`${candidate.source}: ${fetched.error || "no pdf"}`);
  }

  return {
    doi: normalizedDoi,
    status: candidates.length > 0 ? "linked" : "failed",
    link: candidates[0]?.url,
    source: candidates[0]?.source,
    message: candidates.length > 0
      ? `找到了候选 OA 链接但未能下载 PDF：${errors.join("; ")}`
      : "未找到开放获取 PDF 链接",
  };
}

export async function downloadInstitutionalPaperByDoi(
  doi: string,
  paper: Partial<LiteratureRecord> = {},
  landingUrl = ""
): Promise<PaperDownloadResult> {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    return { doi: "", status: "failed", source: "Institutional Browser", message: "DOI 为空" };
  }

  let browser: BrowserLike | null = null;
  try {
    const chromium = loadOpenclawChromium() as {
      launch(options: Record<string, unknown>): Promise<BrowserLike>;
    };
    browser = await chromium.launch({
      headless: String(process.env.INSTITUTION_BROWSER_HEADLESS || "true").toLowerCase() !== "false",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
      userAgent: process.env.INSTITUTION_BROWSER_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    });
    const page = await context.newPage();
    const startUrl = landingUrl && /^https?:\/\//i.test(landingUrl)
      ? landingUrl
      : `https://doi.org/${encodeURIComponent(normalizedDoi)}`;
    const response = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    const finalUrl = page.url();
    const userAgent = process.env.INSTITUTION_BROWSER_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

    if (/\.pdf(?:[?#].*)?$/i.test(finalUrl) || /application\/pdf/i.test(response?.headers()?.["content-type"] || "")) {
      const fetched = await tryDownloadViaBrowserCookies(finalUrl, context, userAgent);
      if (fetched.buffer) {
        return {
          doi: normalizedDoi,
          status: "downloaded",
          buffer: fetched.buffer,
          filename: `${sanitizeZipName(normalizedDoi.replace(/\//g, "_"))}.pdf`,
          link: finalUrl,
          source: "Institutional Browser",
          message: `机构网络页面直达 PDF，downloaded ${fetched.buffer.length} bytes`,
        };
      }
    }

    const rawCandidates = await page.evaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll('a, iframe, embed, object, meta'));
      return nodes.map((el) => ({
        url: el.href || el.src || el.data || el.content || '',
        text: [
          el.innerText || '',
          el.textContent || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('name') || '',
          el.getAttribute('property') || ''
        ].join(' ')
      })).filter((item) => item.url);
    })()`);
    const candidates = collectInstitutionalPdfCandidates(rawCandidates, finalUrl);
    const errors: string[] = [];
    for (const candidate of candidates) {
      const fetched = await tryDownloadViaBrowserCookies(candidate.url, context, userAgent);
      if (fetched.buffer) {
        return {
          doi: normalizedDoi,
          status: "downloaded",
          buffer: fetched.buffer,
          filename: `${sanitizeZipName(normalizedDoi.replace(/\//g, "_"))}.pdf`,
          link: candidate.url,
          source: "Institutional Browser",
          message: `机构网络命中 PDF 链接${candidate.label ? `（${candidate.label.slice(0, 80)}）` : ""}，downloaded ${fetched.buffer.length} bytes`,
        };
      }
      errors.push(`${candidate.url}: ${fetched.error || "not a PDF"}`);
    }

    const locator = page.locator("a", { hasText: /PDF|Download PDF|Full Text PDF|全文|下载/i });
    if (await locator.count()) {
      const downloadPromise = page.waitForEvent("download", { timeout: 12000 }).catch(() => null);
      await locator.first().click({ timeout: 12000 }).catch(() => undefined);
      const download = await downloadPromise;
      const filePath = await download?.path();
      if (filePath && fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        if (buffer.subarray(0, 5).toString("utf-8").startsWith("%PDF")) {
          return {
            doi: normalizedDoi,
            status: "downloaded",
            buffer,
            filename: sanitizeZipName(download?.suggestedFilename?.() || `${normalizedDoi.replace(/\//g, "_")}.pdf`),
            link: finalUrl,
            source: "Institutional Browser",
            message: `机构网络点击 PDF 下载成功，downloaded ${buffer.length} bytes`,
          };
        }
      }
    }

    return {
      doi: normalizedDoi,
      status: "failed",
      link: finalUrl,
      source: "Institutional Browser",
      message: candidates.length > 0
        ? `机构网络页面发现候选 PDF 链接但未能下载：${errors.slice(0, 5).join("; ")}`
        : "机构网络页面未发现可下载 PDF 链接；请确认已连接学校 VPN/校园网且该文献有订阅权限",
    };
  } catch (error) {
    return {
      doi: normalizedDoi,
      status: "failed",
      source: "Institutional Browser",
      message: `机构网络下载失败：${(error as Error).message}`,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

async function downloadPaperByDoi(
  apiUrl: string,
  apiKey: string,
  doi: string,
  paper: LiteratureRecord
): Promise<PaperDownloadResult> {
  const endpoint = apiUrl.includes("{doi}")
    ? apiUrl.replace(/\{doi\}/g, encodeURIComponent(doi))
    : apiUrl;
  const method = apiUrl.includes("{doi}") ? "GET" : "POST";
  const headers: Record<string, string> = {
    Accept: "application/pdf,application/json,text/plain,*/*",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({
      doi,
      dois: [doi],
      title: paper.title || "",
      year: paper.year || "",
      journal: paper.journal || "",
      id: getLiteratureRecordKey(paper),
    });
  }

  const response = await fetch(endpoint, init);
  if (!response.ok) {
    return { doi, status: "failed", message: `API 返回 HTTP ${response.status}` };
  }

  const contentType = response.headers.get("content-type") || "";
  if (/application\/pdf|application\/octet-stream/i.test(contentType)) {
    const buffer = await responseToBuffer(response);
    return {
      doi,
      status: "downloaded",
      buffer,
      filename: `${sanitizeZipName(doi.replace(/\//g, "_"))}.pdf`,
      message: `downloaded ${buffer.length} bytes`,
    };
  }

  if (/application\/json/i.test(contentType)) {
    const json = await response.json() as unknown;
    const base64Pdf = extractBase64PdfFromJson(json);
    if (base64Pdf) {
      const buffer = Buffer.from(base64Pdf, "base64");
      return {
        doi,
        status: "downloaded",
        buffer,
        filename: `${sanitizeZipName(doi.replace(/\//g, "_"))}.pdf`,
        message: `downloaded ${buffer.length} bytes from base64 payload`,
      };
    }
    const url = extractDownloadUrlFromJson(json);
    if (url) {
      const fetched = await fetchPdfByUrl(url, apiKey);
      if (fetched.buffer && /application\/pdf|application\/octet-stream/i.test(fetched.contentType)) {
        return {
          doi,
          status: "downloaded",
          buffer: fetched.buffer,
          filename: `${sanitizeZipName(doi.replace(/\//g, "_"))}.pdf`,
          link: url,
          message: `downloaded ${fetched.buffer.length} bytes from returned URL`,
        };
      }
      return { doi, status: "linked", link: url, message: fetched.error || "API 返回了下载链接，但链接未返回 PDF；已写入报告" };
    }
    return { doi, status: "failed", message: "API JSON 中未找到 PDF、base64 或下载链接" };
  }

  const text = (await response.text()).trim();
  if (/^https?:\/\//i.test(text)) {
    const fetched = await fetchPdfByUrl(text, apiKey);
    if (fetched.buffer && /application\/pdf|application\/octet-stream/i.test(fetched.contentType)) {
      return {
        doi,
        status: "downloaded",
        buffer: fetched.buffer,
        filename: `${sanitizeZipName(doi.replace(/\//g, "_"))}.pdf`,
        link: text,
        message: `downloaded ${fetched.buffer.length} bytes from returned URL`,
      };
    }
    return { doi, status: "linked", link: text, message: fetched.error || "API 返回了下载链接，但链接未返回 PDF；已写入报告" };
  }

  return { doi, status: "failed", message: text.slice(0, 500) || "API 未返回可识别的 PDF 或链接" };
}

export function createEmbeddingLibraryRouter(options: EmbeddingLibraryRoutesOptions): Router {
  const router = Router();
  const pageSize = options.pageSize || EMBEDDING_LIBRARY_PAGE_SIZE;

  router.get("/", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const paperOffset = parsePageNumber(req.query.paperOffset ?? req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const paperLimit = parsePageNumber(req.query.paperLimit ?? req.query.limit, pageSize, 1000) || pageSize;
      const tagOffset = parsePageNumber(req.query.tagOffset, 0, Number.MAX_SAFE_INTEGER);
      const tagLimit = parsePageNumber(req.query.tagLimit, pageSize, 1000) || pageSize;
      const papers = userVisiblePapers(options, userId);
      const favoriteIds = getLibraryFavoriteSet(userId, "embedding");
      let outerTags = options.loadOuterTagsConfigForUser(userId);
      outerTags = options.refreshOuterTagCounts(papers, outerTags);
      options.saveOuterTagsConfigForUser(userId, outerTags);

      const tags = computeKeywordTags(papers);
      const tagPage = paginateKeywordTags(tags.tags, {
        offset: tagOffset,
        limit: tagLimit,
        query: req.query.tagQuery ? String(req.query.tagQuery) : undefined,
      });
      const rawPaperPage = paginateLiteratureRecords(papers, paperOffset, paperLimit);
      const paperPage = {
        ...rawPaperPage,
        papers: withEmbeddingFavoriteFlags(rawPaperPage.papers, favoriteIds),
      };
      const summary = summarizeEmbeddingLibrary(papers, outerTags);

      res.json({
        success: true,
        summary,
        tags: tagPage.tags,
        totalKeywords: tags.totalKeywords,
        tagPage,
        paperPage,
        papers: paperPage.papers,
        favoriteIds: Array.from(favoriteIds),
        outerTags,
      });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Query route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/literature/:id", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const paper = findLiteratureRecord(userVisiblePapers(options, userId), req.params.id);

      if (!paper) {
        res.status(404).json({ success: false, error: "未找到该文献" });
        return;
      }

      res.json({
        success: true,
        literature: {
          ...paper,
          id: getLiteratureRecordKey(paper),
          favorite: getLibraryFavoriteSet(userId, "embedding").has(getLiteratureRecordKey(paper)),
          allKeywords: getPaperKeywords(paper),
          embeddingDimension: Array.isArray(paper.embedding) ? paper.embedding.length : 0,
          preview: toLiteraturePreview(paper),
        },
      });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Detail route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/tags", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const offset = parsePageNumber(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const limit = parsePageNumber(req.query.limit, pageSize, 1000) || pageSize;
      const query = req.query.query ? String(req.query.query) : undefined;
      const tags = computeKeywordTags(userVisiblePapers(options, userId));
      res.json({ success: true, ...paginateKeywordTags(tags.tags, { offset, limit, query }) });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Tags route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/groups", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const maxGroups = Number(req.query.maxGroups || 50);
      res.json({ success: true, ...computeKeywordGroups(userVisiblePapers(options, userId), maxGroups) });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Groups route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/outer-tags", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const papers = userVisiblePapers(options, userId);
      const refreshed = options.refreshOuterTagCounts(papers, options.loadOuterTagsConfigForUser(userId));
      options.saveOuterTagsConfigForUser(userId, refreshed);
      res.json({ success: true, config: refreshed });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Load outer tags error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/outer-tags", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const rawConfig = (body.config || body) as OuterTagsConfig;
      const config = options.saveOuterTagsConfigForUser(
        userId,
        options.refreshOuterTagCounts(userVisiblePapers(options, userId), rawConfig)
      );
      res.json({ success: true, config });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Save outer tags error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/filter", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const outerTags = options.loadOuterTagsConfigForUser(userId);
      const filterOptions = body.options
        ? body.options as KeywordFilterOptions
        : body as KeywordFilterOptions;
      const result = filterLiteraturesByKeywords(userVisiblePapers(options, userId), filterOptions, outerTags);
      const favoriteIds = getLibraryFavoriteSet(userId, "embedding");
      res.json({
        success: true,
        ...result,
        papers: withEmbeddingFavoriteFlags(result.papers, favoriteIds),
        favoriteIds: Array.from(favoriteIds),
      });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Filter route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/literatures-by-keyword", (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "web-user");
      const keyword = String(req.query.keyword || "");
      const originalKeywords = String(req.query.originalKeywords || "")
        .split(/[;；,，]/)
        .map(item => item.trim())
        .filter(Boolean);
      const outerTags = options.loadOuterTagsConfigForUser(userId);
      const offset = parsePageNumber(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const limit = parsePageNumber(req.query.limit, pageSize, 1000) || pageSize;
      const result = filterLiteraturesByKeywords(userVisiblePapers(options, userId), {
        keywords: originalKeywords.length > 0 ? originalKeywords : [keyword],
        mode: "OR",
        offset,
        limit,
      }, outerTags);
      const favoriteIds = getLibraryFavoriteSet(userId, "embedding");
      res.json({
        success: true,
        literatures: withEmbeddingFavoriteFlags(result.papers, favoriteIds),
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
        favoriteIds: Array.from(favoriteIds),
      });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Literatures by keyword error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/manual-merge", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const keywords = Array.isArray(body.keywords) ? body.keywords.map(String) : [];
      const newName = String(body.newName || "");
      if (keywords.length < 2 || newName.trim().length < 2) {
        res.status(400).json({ success: false, error: "至少选择 2 个关键词，并提供新标签名称" });
        return;
      }

      const mergeResult = manualMergeKeywords(userVisiblePapers(options, userId), keywords, newName);
      res.json({ success: true, ...mergeResult });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Manual merge error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/refresh-merged-tags", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const papers = userVisiblePapers(options, userId);
      const refreshed = options.refreshOuterTagCounts(papers, options.loadOuterTagsConfigForUser(userId));
      const saved = options.saveOuterTagsConfigForUser(userId, refreshed);
      res.json({ success: true, config: saved });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Refresh merged tags error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/favorites", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const paperId = String(body.paperId || body.id || "").trim();
      const favorite = body.favorite !== false;
      const papers = userVisiblePapers(options, userId);
      if (!findLiteratureRecord(papers, paperId)) {
        res.status(404).json({ success: false, error: "未找到该文献" });
        return;
      }

      res.json({
        success: true,
        paperId,
        ...toggleLibraryFavorite(userId, "embedding", paperId, favorite),
      });
    } catch (error) {
      logger.error("[EmbeddingLibrary] Favorite route error:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/download-by-doi", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const userId = String(body.userId || "web-user");
      const apiUrl = String(body.apiUrl || process.env.PAPER_DOWNLOAD_API_URL || "").trim();
      const apiKey = String(body.apiKey || process.env.PAPER_DOWNLOAD_API_KEY || "").trim();
      if (apiUrl && !/^https?:\/\//i.test(apiUrl)) {
        res.status(400).json({ success: false, error: "请提供合法的开放获取论文下载 API URL" });
        return;
      }

      const papers = userVisiblePapers(options, userId);
      let selectedPapers: LiteratureRecord[] = [];
      if (body.selectionMode === "filtered") {
        const outerTags = options.loadOuterTagsConfigForUser(userId);
        const filterOptions = (body.options || {}) as KeywordFilterOptions;
        const selectedById = new Map<string, LiteratureRecord>();
        for (let offset = 0; offset < papers.length; offset += 1000) {
          const page = filterLiteraturesByKeywords(papers, {
            ...filterOptions,
            offset,
            limit: 1000,
          }, outerTags);
          page.papers
            .map(preview => findLiteratureRecord(papers, preview.id))
            .filter((paper): paper is LiteratureRecord => !!paper)
            .forEach(paper => selectedById.set(getLiteratureRecordKey(paper), paper));
          if (!page.hasMore) break;
        }
        selectedPapers = Array.from(selectedById.values());
      } else {
        const ids = Array.isArray(body.paperIds)
          ? body.paperIds.map(id => String(id || "").trim()).filter(Boolean)
          : [];
        const idSet = new Set(ids);
        selectedPapers = papers.filter(paper => idSet.has(getLiteratureRecordKey(paper)));
      }

      const doiToPaper = new Map<string, LiteratureRecord>();
      for (const paper of selectedPapers) {
        const doi = normalizeDoi(paper.doi);
        if (doi && !doiToPaper.has(doi.toLowerCase())) {
          doiToPaper.set(doi.toLowerCase(), paper);
        }
      }

      if (doiToPaper.size === 0) {
        res.status(400).json({ success: false, error: "选中文献中没有可用 DOI" });
        return;
      }

      const downloadConcurrency = parseDownloadConcurrency(
        body.downloadConcurrency ?? body.concurrency ?? process.env.OA_PAPER_DOWNLOAD_CONCURRENCY,
        4
      );
      const useInstitutionalDownload = body.useInstitutionalDownload === true || body.institutionalDownload === true || body.institutionalAccess === true;
      const downloadResults = await runConcurrent(Array.from(doiToPaper.entries()), downloadConcurrency, async ([doiKey, paper]) => {
        const doi = normalizeDoi(paper.doi) || doiKey;
        try {
          const result = apiUrl
            ? await downloadPaperByDoi(apiUrl, apiKey, doi, paper)
            : await downloadOpenAccessPaperByDoi(doi, paper);
          return { paper, ...result };
        } catch (error) {
          return {
            paper,
            doi,
            status: "failed" as const,
            message: (error as Error).message,
          };
        }
      });

      if (useInstitutionalDownload && !apiUrl) {
        const fallbackIndexes = downloadResults
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.status !== "downloaded");
        const fallbackConcurrency = Math.min(2, parseDownloadConcurrency(body.institutionalConcurrency, 1));
        const fallbackResults = await runConcurrent(fallbackIndexes, fallbackConcurrency, async ({ item }) => {
          return downloadInstitutionalPaperByDoi(item.doi, item.paper, item.link || "");
        });
        fallbackResults.forEach((fallback, fallbackIndex) => {
          const targetIndex = fallbackIndexes[fallbackIndex]?.index;
          if (targetIndex === undefined) return;
          const current = downloadResults[targetIndex];
          if (fallback.status === "downloaded") {
            downloadResults[targetIndex] = { paper: current.paper, ...fallback };
            return;
          }
          downloadResults[targetIndex] = {
            ...current,
            source: [current.source, fallback.source].filter(Boolean).join("; "),
            message: [current.message, fallback.message].filter(Boolean).join(" | 机构网络兜底："),
          };
        });
      }

      const filename = `embedding-library-doi-download-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (error) => {
        logger.error("[EmbeddingLibrary] DOI download zip error:", error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: error.message });
        } else {
          res.destroy(error);
        }
      });
      archive.pipe(res);

      const reportRows = downloadResults.map((item, index) => {
        const paper = item.paper as LiteratureRecord;
        return {
          index: index + 1,
          status: item.status,
          doi: item.doi,
          title: getPaperDisplayTitle(paper),
          year: paper.year || "",
          journal: paper.journal || "",
          link: item.link || "",
          source: item.source || "",
          message: item.message || "",
        };
      });
      const reportJson = {
        generatedAt: new Date().toISOString(),
        apiUrl: apiUrl
          ? (apiUrl.includes("{doi}") ? apiUrl : `${apiUrl} (POST per DOI)`)
          : BUILT_IN_OA_DOWNLOAD_SOURCE_LABEL,
        selectedPaperCount: selectedPapers.length,
        uniqueDoiCount: doiToPaper.size,
        concurrency: downloadConcurrency,
        institutionalDownloadEnabled: useInstitutionalDownload,
        downloadedCount: downloadResults.filter(item => item.status === "downloaded").length,
        linkedCount: downloadResults.filter(item => item.status === "linked").length,
        failedCount: downloadResults.filter(item => item.status === "failed").length,
        results: reportRows,
      };
      const reportCsv = [
        ["index", "status", "doi", "title", "year", "journal", "link", "source", "message"],
        ...reportRows.map(row => [
          row.index,
          row.status,
          row.doi,
          row.title,
          row.year,
          row.journal,
          row.link,
          row.source,
          row.message,
        ]),
      ].map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

      for (const item of downloadResults) {
        if (item.status !== "downloaded" || !item.buffer) continue;
        const paper = item.paper as LiteratureRecord;
        const title = sanitizeZipName(getPaperDisplayTitle(paper));
        archive.append(item.buffer, { name: `pdf/${sanitizeZipName(`${title}-${item.doi.replace(/\//g, "_")}`)}.pdf` });
      }
      archive.append(JSON.stringify(reportJson, null, 2), { name: "download-report.json" });
      archive.append(reportCsv, { name: "download-report.csv" });
      await archive.finalize();
    } catch (error) {
      logger.error("[EmbeddingLibrary] DOI download route error:", error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: (error as Error).message });
      } else {
        res.destroy(error as Error);
      }
    }
  });

  return router;
}

export default createEmbeddingLibraryRouter;
