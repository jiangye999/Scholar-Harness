import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';
import {
  MailboxManager,
  type CachedMailMessage,
  type MailAccountInput,
  type MailFolder,
} from '../services/mailbox-manager';

interface EmailWorkspaceRouterOptions {
  mailboxManager: MailboxManager;
  generateReplyDraft: (input: {
    subject: string;
    from: string;
    date: string;
    body: string;
    instruction: string;
    tone: string;
  }) => Promise<string>;
}

const EMAIL_REPLY_ATTACHMENT_LIMIT = 20;
const EMAIL_REPLY_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const emailReplyAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: EMAIL_REPLY_ATTACHMENT_LIMIT,
    fileSize: EMAIL_REPLY_ATTACHMENT_BYTES,
    fields: 20,
  },
}).array('attachments', EMAIL_REPLY_ATTACHMENT_LIMIT);

function sendError(res: Response, status: number, code: string, message: string, recoverable = true): void {
  res.status(status).json({ success: false, error: { code, message, recoverable } });
}

function userIdFrom(req: Request): string {
  return sanitizeUserId(req.body?.userId || req.query.userId || 'web-user');
}

function mailFolderFrom(value: unknown): MailFolder {
  return value === 'drafts' || value === 'sent' ? value : 'inbox';
}

function publicMessage(message: CachedMailMessage) {
  return {
    ...message,
    attachments: (message.attachments || []).map(attachment => {
      const { storageKey: _storageKey, ...safeAttachment } = attachment;
      return safeAttachment;
    }),
  };
}

export function createEmailWorkspaceRouter(options: EmailWorkspaceRouterOptions): Router {
  const router = Router();

  router.get('/accounts', async (req, res) => {
    try {
      const accounts = await options.mailboxManager.listAccounts(userIdFrom(req), true);
      res.json({ success: true, accounts });
    } catch (error) {
      sendError(res, 500, 'EMAIL_ACCOUNTS_READ_FAILED', (error as Error).message);
    }
  });

  router.post('/accounts', async (req, res) => {
    try {
      const input = req.body as MailAccountInput;
      const account = await options.mailboxManager.addAccount(userIdFrom(req), input);
      res.status(201).json({ success: true, account });
    } catch (error) {
      logger.warn('[EmailWorkspace] Failed to add mailbox:', (error as Error).message);
      sendError(res, 400, 'EMAIL_ACCOUNT_CONNECT_FAILED', (error as Error).message);
    }
  });

  router.delete('/accounts/:accountId', async (req, res) => {
    try {
      await options.mailboxManager.removeAccount(userIdFrom(req), String(req.params.accountId || ''));
      res.json({ success: true });
    } catch (error) {
      sendError(res, 404, 'EMAIL_ACCOUNT_DELETE_FAILED', (error as Error).message);
    }
  });

  router.post('/accounts/:accountId/sync', async (req, res) => {
    try {
      const userId = userIdFrom(req);
      const accountId = String(req.params.accountId || '');
      const folder = mailFolderFrom(req.body?.folder);
      const count = await options.mailboxManager.syncFolder(userId, accountId, folder, 0);
      const summary = await options.mailboxManager.getSummary(userId);
      const accountSummary = summary.accounts.find(item => item.accountId === accountId) || {
        accountId,
        total: 0,
        unread: 0,
      };
      res.json({ success: true, count, folder, accountSummary, summary });
    } catch (error) {
      sendError(res, 502, 'EMAIL_SYNC_FAILED', (error as Error).message);
    }
  });

  router.get('/messages', async (req, res) => {
    try {
      const messages = await options.mailboxManager.listMessages(
        userIdFrom(req),
        String(req.query.accountId || '') || undefined,
        Number(req.query.limit || 0),
        mailFolderFrom(req.query.folder),
      );
      res.json({ success: true, messages: messages.map(publicMessage) });
    } catch (error) {
      sendError(res, 500, 'EMAIL_MESSAGES_READ_FAILED', (error as Error).message);
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const userId = userIdFrom(req);
      // The top-level unread badge is available before the mail workspace is
      // opened. Make that lightweight request also start/restore IMAP IDLE
      // connections, otherwise new mail is only discovered after the user
      // clicks the mail entry and `/accounts` happens to connect everything.
      await options.mailboxManager.listAccounts(userId, true);
      const summary = await options.mailboxManager.getSummary(userId);
      res.json({ success: true, summary });
    } catch (error) {
      sendError(res, 500, 'EMAIL_SUMMARY_READ_FAILED', (error as Error).message);
    }
  });

  router.get('/wiki', async (req, res) => {
    try {
      const graph = await options.mailboxManager.buildWikiGraph(userIdFrom(req));
      res.json({ success: true, graph });
    } catch (error) {
      sendError(res, 500, 'EMAIL_WIKI_BUILD_FAILED', (error as Error).message);
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const results = await options.mailboxManager.searchMessages(userIdFrom(req), {
        query: String(req.query.query || ''),
        accountId: String(req.query.accountId || '') || undefined,
        sender: String(req.query.sender || '') || undefined,
        unreadOnly: String(req.query.unreadOnly || '') === 'true',
        dateFrom: String(req.query.dateFrom || '') || undefined,
        dateTo: String(req.query.dateTo || '') || undefined,
        limit: Number(req.query.limit || 12),
      });
      res.json({ success: true, results });
    } catch (error) {
      sendError(res, 500, 'EMAIL_SEARCH_FAILED', (error as Error).message);
    }
  });

  router.get('/wiki/query', async (req, res) => {
    try {
      const requestedType = String(req.query.nodeType || '');
      const nodeType = ['account', 'sender', 'message', 'keyword'].includes(requestedType)
        ? requestedType as 'account' | 'sender' | 'message' | 'keyword'
        : undefined;
      const graph = await options.mailboxManager.queryWikiGraph(userIdFrom(req), {
        query: String(req.query.query || ''),
        nodeType,
        limit: Number(req.query.limit || 80),
      });
      res.json({ success: true, graph });
    } catch (error) {
      sendError(res, 500, 'EMAIL_WIKI_QUERY_FAILED', (error as Error).message);
    }
  });

  router.get('/messages/:messageId', async (req, res) => {
    try {
      const accountId = String(req.query.accountId || '');
      if (!accountId) {
        sendError(res, 400, 'EMAIL_ACCOUNT_REQUIRED', '缺少邮箱账户标识。', false);
        return;
      }
      const message = await options.mailboxManager.getMessage(
        userIdFrom(req),
        accountId,
        String(req.params.messageId || ''),
      );
      res.json({ success: true, message });
    } catch (error) {
      const message = String((error as Error).message || '读取邮件正文失败。');
      const status = message.includes('不存在') || message.includes('移除')
        ? 404
        : message.includes('超时')
          ? 504
          : 502;
      sendError(res, status, 'EMAIL_MESSAGE_READ_FAILED', message);
    }
  });

  router.get('/messages/:messageId/attachments/:attachmentId/download', async (req, res) => {
    try {
      const accountId = String(req.query.accountId || '');
      if (!accountId) {
        sendError(res, 400, 'EMAIL_ACCOUNT_REQUIRED', '缺少邮箱账户标识。', false);
        return;
      }
      const attachment = await options.mailboxManager.resolveAttachmentFile(
        userIdFrom(req),
        accountId,
        String(req.params.messageId || ''),
        String(req.params.attachmentId || ''),
      );
      res.type(attachment.contentType);
      res.download(attachment.filePath, attachment.filename, error => {
        if (!error || res.headersSent) return;
        logger.warn('[EmailWorkspace] Failed to download incoming attachment:', error.message);
        sendError(res, 500, 'EMAIL_ATTACHMENT_DOWNLOAD_FAILED', '附件下载失败，请稍后重试。');
      });
    } catch (error) {
      const message = (error as Error).message || '附件下载失败。';
      const status = message.includes('准备') ? 409 : message.includes('不存在') || message.includes('移除') ? 404 : 500;
      sendError(res, status, 'EMAIL_ATTACHMENT_DOWNLOAD_FAILED', message);
    }
  });

  router.post('/messages/:messageId/attachments/prepare', async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || '');
      if (!accountId) {
        sendError(res, 400, 'EMAIL_ACCOUNT_REQUIRED', '缺少邮箱账户标识。', false);
        return;
      }
      const message = await options.mailboxManager.prepareMessageAttachments(
        userIdFrom(req),
        accountId,
        String(req.params.messageId || ''),
      );
      res.json({ success: true, message: publicMessage(message) });
    } catch (error) {
      const message = (error as Error).message || '附件准备失败。';
      const status = message.includes('不存在') || message.includes('移除') ? 404 : 502;
      sendError(res, status, 'EMAIL_ATTACHMENT_PREPARE_FAILED', message);
    }
  });

  router.post('/messages/:messageId/read', async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || '');
      if (!accountId) {
        sendError(res, 400, 'EMAIL_ACCOUNT_REQUIRED', '缺少邮箱账户标识。', false);
        return;
      }
      const message = await options.mailboxManager.markMessageSeen(
        userIdFrom(req),
        accountId,
        String(req.params.messageId || ''),
      );
      res.json({ success: true, message });
    } catch (error) {
      sendError(res, 502, 'EMAIL_MARK_READ_FAILED', (error as Error).message);
    }
  });

  router.post('/messages/read-all', async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || '') || undefined;
      const count = await options.mailboxManager.markAllMessagesSeen(userIdFrom(req), accountId);
      const summary = await options.mailboxManager.getSummary(userIdFrom(req));
      res.json({ success: true, count, summary });
    } catch (error) {
      sendError(res, 502, 'EMAIL_MARK_ALL_READ_FAILED', (error as Error).message);
    }
  });

  router.get('/events', (req, res) => {
    const userId = userIdFrom(req);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const unsubscribe = options.mailboxManager.subscribe(userId, event => {
      res.write(`event: mailbox\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post('/draft-reply', async (req, res) => {
    try {
      if (req.body?.authorized !== true) {
        sendError(res, 403, 'EMAIL_AI_CONSENT_REQUIRED', '请先明确授权 AI 读取当前这封邮件并生成草稿。', false);
        return;
      }
      const accountId = String(req.body?.accountId || '');
      const messageId = String(req.body?.messageId || '');
      const message = await options.mailboxManager.getMessage(userIdFrom(req), accountId, messageId);
      const draft = await options.generateReplyDraft({
        subject: message.subject,
        from: message.from,
        date: message.date,
        body: message.text.slice(0, 30_000),
        instruction: String(req.body?.instruction || '').trim().slice(0, 2_000),
        tone: String(req.body?.tone || '专业、礼貌、简洁').trim().slice(0, 100),
      });
      res.json({ success: true, draft: String(draft || '').trim() });
    } catch (error) {
      logger.warn('[EmailWorkspace] AI reply draft failed:', (error as Error).message);
      sendError(res, 502, 'EMAIL_AI_DRAFT_FAILED', (error as Error).message);
    }
  });

  router.post('/send', (req, res) => {
    emailReplyAttachmentUpload(req, res, async uploadError => {
      if (uploadError) {
        const message = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE'
          ? '单个附件不能超过 25 MB。'
          : uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_COUNT'
            ? '一次最多发送 20 个附件。'
            : (uploadError as Error).message || '附件上传失败。';
        sendError(res, 413, 'EMAIL_ATTACHMENT_UPLOAD_LIMIT', message, true);
        return;
      }
      try {
        const confirmed = req.body?.confirmed === true || String(req.body?.confirmed || '').toLowerCase() === 'true';
        if (!confirmed) {
          sendError(res, 403, 'EMAIL_SEND_CONFIRMATION_REQUIRED', '请在发送前明确确认收件人、主题和正文。', false);
          return;
        }
        const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
        const result = await options.mailboxManager.sendReply(userIdFrom(req), {
          accountId: String(req.body?.accountId || ''),
          messageId: String(req.body?.messageId || ''),
          to: String(req.body?.to || ''),
          subject: String(req.body?.subject || ''),
          body: String(req.body?.body || ''),
          attachments: files.map(file => ({
            filename: file.originalname,
            contentType: file.mimetype,
            content: file.buffer,
          })),
        });
        const { sentMessage, ...delivery } = result;
        res.json({
          success: true,
          result: {
            ...delivery,
            sentMessage: sentMessage ? publicMessage(sentMessage) : undefined,
          },
        });
      } catch (error) {
        logger.warn('[EmailWorkspace] Email send failed:', (error as Error).message);
        sendError(res, 502, 'EMAIL_SEND_FAILED', (error as Error).message);
      }
    });
  });

  return router;
}
