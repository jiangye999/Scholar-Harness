import { Router, Request, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';

const router = Router();

type DownloadAsset = {
  key: string;
  label: string;
  platform: string;
  downloadUrl: string;
};

type DownloadStatRow = {
  asset_key: string;
  label: string;
  platform: string;
  download_url: string;
  total_count: string | number;
  last_download_at: Date | string | null;
};

type PageViewStatRow = {
  page_key: string;
  label: string;
  path: string;
  total_count: string | number;
  last_view_at: Date | string | null;
};

const DOWNLOAD_ASSETS: DownloadAsset[] = [
  {
    key: 'windows',
    label: 'Windows 安装包',
    platform: 'windows',
    downloadUrl: '/downloads/scholar-harness-setup-1.0.8.exe',
  },
  {
    key: 'mac-arm64',
    label: 'Mac M 系列',
    platform: 'macos-arm64',
    downloadUrl: 'https://github.com/jiangye999/Scholar-Harness/releases/download/v1.0.8/scholar-harness-1.0.8-arm64.dmg',
  },
  {
    key: 'mac-x64',
    label: 'Mac Intel',
    platform: 'macos-x64',
    downloadUrl: 'https://github.com/jiangye999/Scholar-Harness/releases/download/v1.0.8/scholar-harness-1.0.8-x64.dmg',
  },
  {
    key: 'manual',
    label: '使用说明 PDF',
    platform: 'manual',
    downloadUrl: '/downloads/scholarharness-user-manual.pdf',
  },
];

const PAGE_VIEW_STATS = [
  {
    key: 'home',
    label: '官网首页',
    path: '/',
  },
] as const;

let db: DatabaseConnection;

export async function initializeDownloadRoutes(database: DatabaseConnection): Promise<void> {
  db = database;
  await ensureDownloadStatsTable();
}

async function ensureDownloadStatsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS download_stats (
      asset_key VARCHAR(80) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      platform VARCHAR(80) NOT NULL,
      download_url TEXT NOT NULL,
      total_count BIGINT NOT NULL DEFAULT 0,
      last_download_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS page_view_stats (
      page_key VARCHAR(80) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      path TEXT NOT NULL,
      total_count BIGINT NOT NULL DEFAULT 0,
      last_view_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const asset of DOWNLOAD_ASSETS) {
    await db.query(
      `INSERT INTO download_stats (asset_key, label, platform, download_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (asset_key) DO UPDATE
       SET label = EXCLUDED.label,
           platform = EXCLUDED.platform,
           download_url = EXCLUDED.download_url,
           updated_at = CURRENT_TIMESTAMP`,
      [asset.key, asset.label, asset.platform, asset.downloadUrl]
    );
  }

  for (const page of PAGE_VIEW_STATS) {
    await db.query(
      `INSERT INTO page_view_stats (page_key, label, path)
       VALUES ($1, $2, $3)
       ON CONFLICT (page_key) DO UPDATE
       SET label = EXCLUDED.label,
           path = EXCLUDED.path,
           updated_at = CURRENT_TIMESTAMP`,
      [page.key, page.label, page.path]
    );
  }
}

function getDownloadAsset(assetKey: unknown): DownloadAsset | null {
  const key = String(assetKey || '').trim();
  if (!key) return null;
  return DOWNLOAD_ASSETS.find(asset => asset.key === key) || null;
}

function normalizeStatRow(row: DownloadStatRow) {
  return {
    key: row.asset_key,
    label: row.label,
    platform: row.platform,
    downloadUrl: row.download_url,
    totalCount: Number(row.total_count || 0),
    lastDownloadAt: row.last_download_at ? new Date(row.last_download_at).toISOString() : null,
  };
}

function normalizePageViewRow(row: PageViewStatRow) {
  return {
    key: row.page_key,
    label: row.label,
    path: row.path,
    totalCount: Number(row.total_count || 0),
    lastViewAt: row.last_view_at ? new Date(row.last_view_at).toISOString() : null,
  };
}

async function incrementDownload(assetKey: string) {
  const rows = await db.query<DownloadStatRow>(
    `UPDATE download_stats
     SET total_count = total_count + 1,
         last_download_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE asset_key = $1
     RETURNING asset_key, label, platform, download_url, total_count, last_download_at`,
    [assetKey]
  );

  if (!rows[0]) {
    throw new Error('Download asset is not registered');
  }
  return normalizeStatRow(rows[0]);
}

async function incrementPageView(pageKey: string) {
  const rows = await db.query<PageViewStatRow>(
    `UPDATE page_view_stats
     SET total_count = total_count + 1,
         last_view_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE page_key = $1
     RETURNING page_key, label, path, total_count, last_view_at`,
    [pageKey]
  );

  if (!rows[0]) {
    throw new Error('Page view stat is not registered');
  }
  return normalizePageViewRow(rows[0]);
}

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [rows, pageRows] = await Promise.all([
      db.query<DownloadStatRow>(
      `SELECT asset_key, label, platform, download_url, total_count, last_download_at
       FROM download_stats
       ORDER BY CASE asset_key
         WHEN 'windows' THEN 1
         WHEN 'mac-arm64' THEN 2
         WHEN 'mac-x64' THEN 3
         WHEN 'manual' THEN 4
         ELSE 99
       END, asset_key ASC`
      ),
      db.query<PageViewStatRow>(
        `SELECT page_key, label, path, total_count, last_view_at
         FROM page_view_stats
         ORDER BY CASE page_key
           WHEN 'home' THEN 1
           ELSE 99
         END, page_key ASC`
      ),
    ]);
    const assets = rows.map(normalizeStatRow);
    const pages = pageRows.map(normalizePageViewRow);
    const installerKeys = new Set(['windows', 'mac-arm64', 'mac-x64']);
    const installerTotalCount = assets
      .filter(asset => installerKeys.has(asset.key))
      .reduce((sum, asset) => sum + asset.totalCount, 0);
    const pageViewTotalCount = pages.reduce((sum, page) => sum + page.totalCount, 0);

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      pageViewTotalCount,
      pageViews: {
        totalCount: pageViewTotalCount,
        pages,
      },
      installerTotalCount,
      totalCount: assets.reduce((sum, asset) => sum + asset.totalCount, 0),
      assets,
    });
  } catch (error) {
    logger.error('[Downloads] Get stats failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get download stats',
    });
  }
});

router.post('/page-view', async (req: Request, res: Response) => {
  try {
    const requestedKey = String(req.body?.pageKey || req.body?.page || 'home').trim();
    const page = PAGE_VIEW_STATS.find(item => item.key === requestedKey);
    if (!page) {
      return res.status(400).json({
        success: false,
        error: 'Unknown page',
      });
    }

    const stat = await incrementPageView(page.key);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      page: stat,
    });
  } catch (error) {
    logger.error('[Downloads] Track page view failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to track page view',
    });
  }
});

router.post('/track', async (req: Request, res: Response) => {
  try {
    const asset = getDownloadAsset(req.body?.assetKey || req.body?.asset || req.body?.key);
    if (!asset) {
      return res.status(400).json({
        success: false,
        error: 'Unknown download asset',
      });
    }

    const stat = await incrementDownload(asset.key);
    return res.json({
      success: true,
      asset: stat,
    });
  } catch (error) {
    logger.error('[Downloads] Track failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to track download',
    });
  }
});

router.get('/redirect/:assetKey', async (req: Request, res: Response) => {
  const asset = getDownloadAsset(req.params.assetKey);
  if (!asset) {
    return res.status(404).json({
      success: false,
      error: 'Unknown download asset',
    });
  }

  try {
    await incrementDownload(asset.key);
  } catch (error) {
    logger.warn('[Downloads] Redirect count failed:', error);
  }

  return res.redirect(302, asset.downloadUrl);
});

export default router;
