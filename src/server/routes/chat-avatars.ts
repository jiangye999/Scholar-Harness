import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { sanitizeUserId } from '../../utils/paths';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_FILE_PATTERN = /^avatar-[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;

interface ChatAvatarRoutesOptions {
  dataDir: string;
}

interface DetectedAvatarType {
  extension: '.png' | '.jpg' | '.webp';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_AVATAR_BYTES,
  },
});

function detectAvatarType(buffer: Buffer): DetectedAvatarType | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.subarray(1, 4).toString('ascii') === 'PNG'
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return { extension: '.png', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: '.jpg', contentType: 'image/jpeg' };
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: '.webp', contentType: 'image/webp' };
  }
  return null;
}

function getUserAvatarRoot(dataDir: string, userIdInput: unknown): string {
  return path.join(dataDir, 'chat-avatars', sanitizeUserId(userIdInput || 'web-user'));
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  recoverable = true,
): void {
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      recoverable,
    },
  });
}

export function createChatAvatarRouter(options: ChatAvatarRoutesOptions): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const root = getUserAvatarRoot(options.dataDir, userId);
      await fs.mkdir(root, { recursive: true });
      const entries = await fs.readdir(root, { withFileTypes: true });
      const avatars = await Promise.all(
        entries
          .filter(entry => entry.isFile() && AVATAR_FILE_PATTERN.test(entry.name))
          .map(async entry => {
            const stat = await fs.stat(path.join(root, entry.name));
            return {
              id: entry.name,
              url: `/api/chat-avatars/file/${encodeURIComponent(entry.name)}?userId=${encodeURIComponent(userId)}`,
              createdAt: stat.birthtime.toISOString(),
              updatedAt: stat.mtime.toISOString(),
            };
          }),
      );
      avatars.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      res.json({ success: true, avatars });
    } catch (error) {
      sendError(res, 500, 'CHAT_AVATAR_LIST_FAILED', (error as Error).message, true);
    }
  });

  router.post('/', upload.single('avatar'), async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer?.length) {
        sendError(res, 400, 'CHAT_AVATAR_FILE_REQUIRED', '请选择需要上传的头像图片。', true);
        return;
      }
      const detected = detectAvatarType(req.file.buffer);
      if (!detected) {
        sendError(res, 415, 'CHAT_AVATAR_FORMAT_UNSUPPORTED', '仅支持 PNG、JPG 和 WebP 头像。', true);
        return;
      }
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      const root = getUserAvatarRoot(options.dataDir, userId);
      await fs.mkdir(root, { recursive: true });
      const id = `avatar-${randomUUID()}${detected.extension}`;
      await fs.writeFile(path.join(root, id), req.file.buffer, { flag: 'wx' });
      res.status(201).json({
        success: true,
        avatar: {
          id,
          url: `/api/chat-avatars/file/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`,
          contentType: detected.contentType,
        },
      });
    } catch (error) {
      sendError(res, 500, 'CHAT_AVATAR_UPLOAD_FAILED', (error as Error).message, true);
    }
  });

  router.get('/file/:avatarId', async (req: Request, res: Response) => {
    try {
      const avatarId = String(req.params.avatarId || '');
      if (!AVATAR_FILE_PATTERN.test(avatarId)) {
        sendError(res, 400, 'CHAT_AVATAR_ID_INVALID', '头像标识无效。', false);
        return;
      }
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const filePath = path.join(getUserAvatarRoot(options.dataDir, userId), avatarId);
      const extension = path.extname(avatarId).toLowerCase();
      const contentType = extension === '.png'
        ? 'image/png'
        : (extension === '.webp' ? 'image/webp' : 'image/jpeg');
      const content = await fs.readFile(filePath);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        sendError(res, 404, 'CHAT_AVATAR_NOT_FOUND', '头像不存在或已被删除。', true);
        return;
      }
      sendError(res, 500, 'CHAT_AVATAR_READ_FAILED', (error as Error).message, true);
    }
  });

  router.delete('/file/:avatarId', async (req: Request, res: Response) => {
    try {
      const avatarId = String(req.params.avatarId || '');
      if (!AVATAR_FILE_PATTERN.test(avatarId)) {
        sendError(res, 400, 'CHAT_AVATAR_ID_INVALID', '头像标识无效。', false);
        return;
      }
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const filePath = path.join(getUserAvatarRoot(options.dataDir, userId), avatarId);
      await fs.rm(filePath, { force: true });
      res.json({ success: true, deletedId: avatarId });
    } catch (error) {
      sendError(res, 500, 'CHAT_AVATAR_DELETE_FAILED', (error as Error).message, true);
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? '处理后的头像不能超过 5 MB。'
        : '头像上传失败，请重新选择图片。';
      sendError(res, 413, 'CHAT_AVATAR_UPLOAD_LIMIT', message, true);
      return;
    }
    sendError(
      res,
      500,
      'CHAT_AVATAR_UPLOAD_FAILED',
      error instanceof Error ? error.message : '头像上传失败。',
      true,
    );
  });

  return router;
}
