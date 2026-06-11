import * as fs from "fs";
import * as path from "path";
import { getDataDir, sanitizeUserId } from "./paths";
import { logger } from "./logger";

export type LibraryFavoriteKind = "embedding" | "pdfWiki" | "pdfWikiPdf";

export interface LibraryFavorites {
  version: 1;
  userId: string;
  embedding: string[];
  pdfWiki: string[];
  pdfWikiPdf: string[];
  updatedAt: string;
}

const EMPTY_FAVORITES: Omit<LibraryFavorites, "userId" | "updatedAt"> = {
  version: 1,
  embedding: [],
  pdfWiki: [],
  pdfWikiPdf: [],
};

function getFavoritesPath(userId: string): string {
  return path.join(getDataDir(), "library-favorites", `${sanitizeUserId(userId)}.json`);
}

function normalizeFavorites(raw: unknown, userId: string): LibraryFavorites {
  const data = raw && typeof raw === "object" ? raw as Partial<LibraryFavorites> : {};
  const unique = (values: unknown): string[] => Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(String)
      .map(item => item.trim())
      .filter(Boolean)
  ));

  return {
    ...EMPTY_FAVORITES,
    userId,
    embedding: unique(data.embedding),
    pdfWiki: unique(data.pdfWiki),
    pdfWikiPdf: unique(data.pdfWikiPdf),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };
}

export function loadLibraryFavorites(userId: string): LibraryFavorites {
  const favoritePath = getFavoritesPath(userId);
  if (!fs.existsSync(favoritePath)) {
    return normalizeFavorites(null, userId);
  }

  try {
    return normalizeFavorites(JSON.parse(fs.readFileSync(favoritePath, "utf-8")), userId);
  } catch (error) {
    logger.warn(`[LibraryFavorites] Failed to read favorites for ${userId}:`, error);
    return normalizeFavorites(null, userId);
  }
}

export function saveLibraryFavorites(userId: string, favorites: LibraryFavorites): LibraryFavorites {
  const normalized = normalizeFavorites(favorites, userId);
  normalized.updatedAt = new Date().toISOString();
  const favoritePath = getFavoritesPath(userId);
  fs.mkdirSync(path.dirname(favoritePath), { recursive: true });
  fs.writeFileSync(favoritePath, JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

export function getLibraryFavoriteSet(userId: string, kind: LibraryFavoriteKind): Set<string> {
  return new Set(loadLibraryFavorites(userId)[kind]);
}

export function toggleLibraryFavorite(
  userId: string,
  kind: LibraryFavoriteKind,
  itemId: string,
  favorite: boolean
): { favorite: boolean; favoriteIds: string[] } {
  const id = String(itemId || "").trim();
  if (!id) {
    throw new Error("缺少收藏对象 ID");
  }

  const favorites = loadLibraryFavorites(userId);
  const ids = new Set(favorites[kind]);
  if (favorite) {
    ids.add(id);
  } else {
    ids.delete(id);
  }

  favorites[kind] = Array.from(ids);
  const saved = saveLibraryFavorites(userId, favorites);
  return {
    favorite: saved[kind].includes(id),
    favoriteIds: saved[kind],
  };
}
