/**
 * 统一路径管理模块
 * 
 * 确保所有模块使用一致的数据目录路径，支持三种运行模式：
 * 1. Electron 打包模式：使用 Electron 的 userData 目录
 * 2. pkg 打包模式：使用用户主目录下的 .scholar-harness
 * 3. 开发模式：使用项目根目录下的 data 目录
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from './logger';
import { resolveProjectOwnedDirectory } from './project-runtime-context';

let cachedDataDir: string | null = null;

/**
 * 规范化用户 ID，避免把外部输入直接拼入数据目录路径。
 */
export function sanitizeUserId(userId: unknown): string {
  const raw = String(userId || 'web-user').trim();
  const cleaned = raw
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9._@-]/g, '_')
    .slice(0, 80);
  return cleaned || 'web-user';
}

/**
 * 获取数据目录路径
 * 
 * 路径解析优先级：
 * 1. 环境变量 DATA_DIR（Electron 设置）
 * 2. pkg 打包模式：~/.scholar-harness/data
 * 3. 开发模式：{projectRoot}/data
 */
export function getDataDir(): string {
  // 返回缓存值
  if (cachedDataDir) {
    return cachedDataDir;
  }

  let dataDir: string;

  // 优先使用 Electron 传递的 DATA_DIR 环境变量
  if (process.env.DATA_DIR) {
    dataDir = process.env.DATA_DIR;
    logger.info('[Paths] Using DATA_DIR from environment:', dataDir);
  }
  // pkg 打包模式
  else if (!!(process as any).pkg) {
    dataDir = path.join(os.homedir(), '.scholar-harness', 'data');
    logger.info('[Paths] Running in pkg mode, data dir:', dataDir);
  }
  // 开发模式
  else {
    // ts-node 开发模式下 __dirname 是 src/utils；编译后是 dist/src/utils。
    const projectRoot = path.basename(path.resolve(__dirname, '..', '..')) === 'dist'
      ? path.resolve(__dirname, '..', '..', '..')
      : path.resolve(__dirname, '..', '..');
    dataDir = path.join(projectRoot, 'data');
    logger.info('[Paths] Running in dev mode, data dir:', dataDir);
  }

  // 确保目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info('[Paths] Created data directory:', dataDir);
  }

  // 缓存结果
  cachedDataDir = dataDir;
  return dataDir;
}

/**
 * Resolve a directory that belongs to the project captured when the current
 * async request started. Global configuration continues to use getDataDir().
 */
export function getProjectOwnedDataDir(directoryName: string): string {
  const target = resolveProjectOwnedDirectory(directoryName, path.join(getDataDir(), directoryName));
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  return target;
}

/**
 * 获取上传目录路径
 */
export function getUploadDir(): string {
  const uploadDir = getProjectOwnedDataDir('uploads');
  
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  return uploadDir;
}

/**
 * 获取用户上传目录路径
 */
export function getUserUploadDir(userId: string): string {
  const userDir = path.join(getUploadDir(), sanitizeUserId(userId));
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  return userDir;
}

/**
 * 获取文献索引缓存目录
 */
export function getIndexCacheDir(userId: string = 'web-user'): string {
  const cacheDir = path.join(getUploadDir(), sanitizeUserId(userId), 'index-cache');
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  return cacheDir;
}

/**
 * 获取用户文献 JSON 文件路径
 */
export function getUserLiteraturePath(userId: string): string {
  return path.join(getUserUploadDir(userId), 'literature.json');
}

/**
 * 获取用户文献 TXT 文件路径
 */
export function getUserLiteratureTxtPath(userId: string): string {
  return path.join(getUserUploadDir(userId), 'literature.txt');
}

/**
 * 获取会话存储目录
 */
export function getSessionDir(): string {
  const sessionDir = getProjectOwnedDataDir('sessions');
  
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  return sessionDir;
}

/**
 * 获取记忆存储目录
 */
export function getMemoryDir(): string {
  const memoryDir = getProjectOwnedDataDir('memory');
  
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  
  return memoryDir;
}

/**
 * 清除缓存（用于测试或强制重新计算路径）
 */
export function clearPathCache(): void {
  cachedDataDir = null;
}

export default {
  getDataDir,
  getProjectOwnedDataDir,
  getUploadDir,
  sanitizeUserId,
  getUserUploadDir,
  getIndexCacheDir,
  getUserLiteraturePath,
  getUserLiteratureTxtPath,
  getSessionDir,
  getMemoryDir,
  clearPathCache,
};
