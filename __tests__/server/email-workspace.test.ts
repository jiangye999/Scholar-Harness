import express from 'express';
import * as path from 'path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createEmailWorkspaceRouter } from '../../src/server/routes/email-workspace';
import { normalizeMailDate, type MailboxManager } from '../../src/server/services/mailbox-manager';

describe('mail date normalization', () => {
  it('falls back when a message contains an invalid Date header', () => {
    expect(normalizeMailDate(new Date('invalid'), '2026-08-03T08:00:00.000Z'))
      .toBe('2026-08-03T08:00:00.000Z');
  });

  it('always returns a valid ISO date when every candidate is malformed', () => {
    const normalized = normalizeMailDate('not-a-date', new Date('invalid'), null);
    expect(Number.isNaN(Date.parse(normalized))).toBe(false);
    expect(() => new Date(normalized).toISOString()).not.toThrow();
  });
});

function createTestApp(overrides: Record<string, unknown> = {}) {
  const mailboxManager = {
    listAccounts: vi.fn(async () => []),
    addAccount: vi.fn(),
    removeAccount: vi.fn(),
    ensureConnected: vi.fn(),
    syncAccount: vi.fn(async () => 0),
    syncFolder: vi.fn(async () => 0),
    listMessages: vi.fn(async () => []),
    getSummary: vi.fn(async () => ({ total: 12, unread: 5, read: 7, accounts: [] })),
    searchMessages: vi.fn(async () => [{
      id: 'account-1:42', accountId: 'account-1', accountEmail: 'user@example.com',
      subject: 'Meeting follow-up', from: 'Sender <sender@example.com>', to: 'user@example.com',
      date: '2026-08-03T08:00:00.000Z', snippet: 'Could we meet next Tuesday?',
      seen: false, contentLoaded: true, score: 18,
    }]),
    buildWikiGraph: vi.fn(async () => ({
      generatedAt: '2026-08-03T08:00:00.000Z',
      counts: { accounts: 1, senders: 2, messages: 12, keywords: 4 },
      nodes: [],
      links: [],
    })),
    queryWikiGraph: vi.fn(async () => ({
      generatedAt: '2026-08-03T08:00:00.000Z',
      counts: { accounts: 1, senders: 2, messages: 12, keywords: 4 },
      nodes: [{ id: 'sender:sender@example.com', type: 'sender', label: 'sender@example.com', weight: 3 }],
      links: [],
    })),
    markMessageSeen: vi.fn(async () => ({
      id: 'account-1:42', accountId: 'account-1', uid: 42, messageId: '<message@example.com>',
      replyToAddress: 'sender@example.com', references: [], subject: 'Meeting follow-up',
      from: 'Sender <sender@example.com>', to: 'User <user@example.com>',
      date: '2026-08-03T08:00:00.000Z', text: '', snippet: '', seen: true,
    })),
    markAllMessagesSeen: vi.fn(async () => 5),
    getMessage: vi.fn(async () => ({
      id: 'account-1:42',
      accountId: 'account-1',
      uid: 42,
      messageId: '<message@example.com>',
      replyToAddress: 'sender@example.com',
      references: [],
      subject: 'Meeting follow-up',
      from: 'Sender <sender@example.com>',
      to: 'User <user@example.com>',
      date: '2026-08-03T08:00:00.000Z',
      text: 'Could we meet next Tuesday?',
      snippet: 'Could we meet next Tuesday?',
      seen: false,
      attachmentsLoaded: true,
      attachments: [{
        id: 'attachment-1', filename: 'agenda.pdf', contentType: 'application/pdf', size: 2048,
        available: true, previewPath: 'C:\\mail-cache\\agenda.pdf', previewRoot: 'C:\\mail-cache',
      }],
    })),
    resolveAttachmentFile: vi.fn(async () => ({
      filePath: path.join(process.cwd(), 'package.json'),
      filename: 'agenda.pdf',
      contentType: 'application/pdf',
      size: 2048,
    })),
    prepareMessageAttachments: vi.fn(async () => ({
      id: 'account-1:42', accountId: 'account-1', uid: 42, messageId: '<message@example.com>',
      replyToAddress: 'sender@example.com', references: [], subject: 'Meeting follow-up',
      from: 'Sender <sender@example.com>', to: 'User <user@example.com>',
      date: '2026-08-03T08:00:00.000Z', text: 'Could we meet next Tuesday?',
      snippet: 'Could we meet next Tuesday?', seen: false, contentLoaded: true, attachmentsLoaded: true,
      attachments: [{
        id: 'attachment-1', filename: 'agenda.pdf', contentType: 'application/pdf', size: 2048,
        available: true, previewPath: 'C:\\mail-cache\\agenda.pdf', previewRoot: 'C:\\mail-cache',
      }],
    })),
    sendReply: vi.fn(async () => ({
      messageId: '<reply@example.com>',
      accepted: ['sender@example.com'],
      rejected: [],
      recordedLocally: true,
      archivedToServer: true,
      sentMessage: {
        id: 'account-1:sent:88', accountId: 'account-1', uid: 88,
        messageId: '<reply@example.com>', replyToAddress: 'sender@example.com', references: [],
        subject: 'Re: Meeting follow-up', from: 'User <user@example.com>', to: 'sender@example.com',
        date: '2026-08-03T08:05:00.000Z', text: 'Confirmed.', snippet: 'Confirmed.',
        seen: true, folder: 'sent', contentLoaded: true, attachmentsLoaded: true,
        attachments: [{
          id: 'sent-attachment-1', filename: 'notes.txt', contentType: 'text/plain', size: 16,
          available: true, storageKey: 'private/sent/notes.txt',
        }],
      },
    })),
    subscribe: vi.fn(() => () => undefined),
    ...overrides,
  };
  const generateReplyDraft = vi.fn(async () => 'Thank you. Next Tuesday works for me.');
  const app = express();
  app.use(express.json());
  app.use('/api/email', createEmailWorkspaceRouter({
    mailboxManager: mailboxManager as unknown as MailboxManager,
    generateReplyDraft,
  }));
  return { app, mailboxManager, generateReplyDraft };
}

describe('email workspace routes', () => {
  it('starts background mailbox connections when the global unread summary is requested', async () => {
    const listAccounts = vi.fn(async () => []);
    const { app } = createTestApp({ listAccounts });

    const response = await request(app)
      .get('/api/email/summary?userId=user-1')
      .expect(200);

    expect(response.body.summary.unread).toBe(5);
    expect(listAccounts).toHaveBeenCalledWith('user-1', true);
  });

  it('does not expose incoming attachment storage keys in the message list', async () => {
    const { app } = createTestApp({
      listMessages: vi.fn(async () => [{
        id: 'account-1:42', accountId: 'account-1', uid: 42, messageId: '<message@example.com>',
        replyToAddress: 'sender@example.com', references: [], subject: 'Attachment', from: 'Sender', to: 'User',
        date: '2026-08-03T08:00:00.000Z', text: '', snippet: '', seen: false,
        attachments: [{ id: 'attachment-1', filename: 'agenda.pdf', contentType: 'application/pdf', size: 2048, available: true, storageKey: 'private/agenda.pdf' }],
      }]),
    });

    const response = await request(app).get('/api/email/messages?userId=user-1').expect(200);
    expect(response.body.messages[0].attachments[0].filename).toBe('agenda.pdf');
    expect(response.body.messages[0].attachments[0]).not.toHaveProperty('storageKey');
  });

  it('downloads an incoming attachment through the validated mailbox resolver', async () => {
    const resolveAttachmentFile = vi.fn(async () => ({
      filePath: path.join(process.cwd(), 'package.json'),
      filename: 'agenda.pdf',
      contentType: 'application/pdf',
      size: 2048,
    }));
    const { app } = createTestApp({ resolveAttachmentFile });

    const response = await request(app)
      .get('/api/email/messages/account-1%3A42/attachments/attachment-1/download?userId=user-1&accountId=account-1')
      .expect(200);
    expect(response.headers['content-disposition']).toContain('agenda.pdf');
    expect(resolveAttachmentFile).toHaveBeenCalledWith('user-1', 'account-1', 'account-1:42', 'attachment-1');
  });

  it('prepares a pending incoming attachment before sidebar preview', async () => {
    const prepareMessageAttachments = vi.fn(async () => ({
      id: 'account-1:42', accountId: 'account-1', uid: 42, messageId: '<message@example.com>',
      replyToAddress: 'sender@example.com', references: [], subject: 'Attachment', from: 'Sender', to: 'User',
      date: '2026-08-03T08:00:00.000Z', text: '', snippet: '', seen: false,
      contentLoaded: true, attachmentsLoaded: true,
      attachments: [{
        id: 'attachment-1', filename: 'agenda.pdf', contentType: 'application/pdf', size: 2048,
        available: true, previewPath: 'C:\\mail-cache\\agenda.pdf', previewRoot: 'C:\\mail-cache',
      }],
    }));
    const { app } = createTestApp({ prepareMessageAttachments });

    const response = await request(app)
      .post('/api/email/messages/account-1%3A42/attachments/prepare')
      .send({ userId: 'user-1', accountId: 'account-1' })
      .expect(200);

    expect(response.body.message.attachments[0].previewPath).toContain('agenda.pdf');
    expect(prepareMessageAttachments).toHaveBeenCalledWith('user-1', 'account-1', 'account-1:42');
  });

  it('does not expose mailbox credentials when listing accounts', async () => {
    const { app } = createTestApp({
      listAccounts: vi.fn(async () => [{
        id: 'account-1',
        provider: 'gmail',
        email: 'user@example.com',
        displayName: 'Work',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        connectionStatus: 'connected',
      }]),
    });

    const response = await request(app).get('/api/email/accounts?userId=user-1').expect(200);
    expect(response.body.accounts).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain('credential');
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('requires explicit per-message consent before invoking AI', async () => {
    const { app, generateReplyDraft } = createTestApp();
    const response = await request(app)
      .post('/api/email/draft-reply')
      .send({ userId: 'user-1', accountId: 'account-1', messageId: 'account-1:42' })
      .expect(403);

    expect(response.body.error.code).toBe('EMAIL_AI_CONSENT_REQUIRED');
    expect(generateReplyDraft).not.toHaveBeenCalled();
  });

  it('passes only the selected cached message to AI after consent', async () => {
    const { app, generateReplyDraft } = createTestApp();
    const response = await request(app)
      .post('/api/email/draft-reply')
      .send({
        userId: 'user-1',
        accountId: 'account-1',
        messageId: 'account-1:42',
        authorized: true,
        tone: 'professional',
        instruction: 'Confirm availability.',
      })
      .expect(200);

    expect(response.body.draft).toContain('Next Tuesday');
    expect(generateReplyDraft).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Meeting follow-up',
      body: 'Could we meet next Tuesday?',
      instruction: 'Confirm availability.',
    }));
  });

  it('returns incoming attachment metadata for right-sidebar previews', async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get('/api/email/messages/account-1%3A42?userId=user-1&accountId=account-1')
      .expect(200);

    expect(response.body.message.attachments).toEqual([expect.objectContaining({
      filename: 'agenda.pdf',
      contentType: 'application/pdf',
      available: true,
      previewPath: 'C:\\mail-cache\\agenda.pdf',
    })]);
  });

  it('reports mailbox body timeouts without pretending the message is missing', async () => {
    const { app } = createTestApp({
      getMessage: vi.fn(async () => {
        throw new Error('邮箱服务器读取正文超时，请检查网络或稍后重试。');
      }),
    });

    const response = await request(app)
      .get('/api/email/messages/account-1%3A42?userId=user-1&accountId=account-1')
      .expect(504);

    expect(response.body.error).toMatchObject({
      code: 'EMAIL_MESSAGE_READ_FAILED',
      recoverable: true,
    });
  });

  it('returns the complete cached inbox when no message limit is requested', async () => {
    const { app, mailboxManager } = createTestApp();
    await request(app)
      .get('/api/email/messages?userId=user-1&accountId=account-1')
      .expect(200);

    expect(mailboxManager.listMessages).toHaveBeenCalledWith('user-1', 'account-1', 0, 'inbox');
  });

  it('uses a full mailbox sync for a manual refresh', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .post('/api/email/accounts/account-1/sync')
      .send({ userId: 'user-1' })
      .expect(200);

    expect(mailboxManager.syncFolder).toHaveBeenCalledWith('user-1', 'account-1', 'inbox', 0);
    expect(mailboxManager.getSummary).toHaveBeenCalledWith('user-1');
    expect(response.body.summary).toMatchObject({ total: 12, unread: 5, read: 7 });
  });

  it('returns an aggregate unread count across every connected account', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app).get('/api/email/summary?userId=user-1').expect(200);

    expect(response.body.summary).toMatchObject({ total: 12, unread: 5, read: 7 });
    expect(mailboxManager.getSummary).toHaveBeenCalledWith('user-1');
  });

  it('marks an opened message read on the mailbox server', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .post('/api/email/messages/account-1%3A42/read')
      .send({ userId: 'user-1', accountId: 'account-1' })
      .expect(200);

    expect(response.body.message.seen).toBe(true);
    expect(mailboxManager.markMessageSeen).toHaveBeenCalledWith('user-1', 'account-1', 'account-1:42');
  });

  it('loads real sent-folder messages and can mark the whole inbox read', async () => {
    const { app, mailboxManager } = createTestApp();
    await request(app)
      .get('/api/email/messages?userId=user-1&accountId=account-1&folder=sent')
      .expect(200);
    expect(mailboxManager.listMessages).toHaveBeenLastCalledWith('user-1', 'account-1', 0, 'sent');

    const response = await request(app)
      .post('/api/email/messages/read-all')
      .send({ userId: 'user-1', accountId: 'account-1' })
      .expect(200);
    expect(response.body.count).toBe(5);
    expect(mailboxManager.markAllMessagesSeen).toHaveBeenCalledWith('user-1', 'account-1');
  });

  it('builds the local Wiki graph from every cached mailbox', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app).get('/api/email/wiki?userId=user-1').expect(200);

    expect(response.body.graph.counts).toMatchObject({ messages: 12, senders: 2 });
    expect(mailboxManager.buildWikiGraph).toHaveBeenCalledWith('user-1');
  });

  it('searches every cached mailbox through the read-only email database API', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .get('/api/email/search?userId=user-1&query=meeting&unreadOnly=true&limit=20')
      .expect(200);

    expect(response.body.results[0]).toMatchObject({ subject: 'Meeting follow-up', seen: false });
    expect(mailboxManager.searchMessages).toHaveBeenCalledWith('user-1', expect.objectContaining({
      query: 'meeting', unreadOnly: true, limit: 20,
    }));
  });

  it('queries a bounded neighborhood from the all-mail knowledge graph', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .get('/api/email/wiki/query?userId=user-1&query=sender&nodeType=sender&limit=40')
      .expect(200);

    expect(response.body.graph.counts.messages).toBe(12);
    expect(mailboxManager.queryWikiGraph).toHaveBeenCalledWith('user-1', {
      query: 'sender', nodeType: 'sender', limit: 40,
    });
  });

  it('requires explicit confirmation before sending a reply', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .post('/api/email/send')
      .send({
        userId: 'user-1', accountId: 'account-1', messageId: 'account-1:42',
        to: 'sender@example.com', subject: 'Re: Meeting follow-up', body: 'Confirmed.',
      })
      .expect(403);

    expect(response.body.error.code).toBe('EMAIL_SEND_CONFIRMATION_REQUIRED');
    expect(mailboxManager.sendReply).not.toHaveBeenCalled();
  });

  it('sends only after the client explicitly confirms the selected reply', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .post('/api/email/send')
      .send({
        userId: 'user-1', accountId: 'account-1', messageId: 'account-1:42',
        to: 'sender@example.com', subject: 'Re: Meeting follow-up', body: 'Confirmed.', confirmed: true,
      })
      .expect(200);

    expect(response.body.result.messageId).toBe('<reply@example.com>');
    expect(response.body.result.recordedLocally).toBe(true);
    expect(response.body.result.archivedToServer).toBe(true);
    expect(response.body.result.sentMessage.folder).toBe('sent');
    expect(response.body.result.sentMessage.attachments[0]).not.toHaveProperty('storageKey');
    expect(mailboxManager.sendReply).toHaveBeenCalledWith('user-1', expect.objectContaining({
      accountId: 'account-1', messageId: 'account-1:42', to: 'sender@example.com',
    }));
  });

  it('sends a new manually composed email without a source message', async () => {
    const { app, mailboxManager } = createTestApp();
    const response = await request(app)
      .post('/api/email/send')
      .send({
        userId: 'user-1', accountId: 'account-1', messageId: '',
        to: 'new-recipient@example.com', subject: 'New message', body: 'Written manually.', confirmed: true,
      })
      .expect(200);

    expect(response.body.result.messageId).toBe('<reply@example.com>');
    expect(mailboxManager.sendReply).toHaveBeenCalledWith('user-1', expect.objectContaining({
      accountId: 'account-1', messageId: '', to: 'new-recipient@example.com',
      subject: 'New message', body: 'Written manually.',
    }));
  });

  it('accepts multiple reply attachments and forwards their buffers to SMTP delivery', async () => {
    const { app, mailboxManager } = createTestApp();
    await request(app)
      .post('/api/email/send')
      .field('userId', 'user-1')
      .field('accountId', 'account-1')
      .field('messageId', 'account-1:42')
      .field('to', 'sender@example.com')
      .field('subject', 'Re: Meeting follow-up')
      .field('body', 'Files attached.')
      .field('confirmed', 'true')
      .attach('attachments', Buffer.from('first attachment'), { filename: 'notes.txt', contentType: 'text/plain' })
      .attach('attachments', Buffer.from('%PDF-test'), { filename: 'agenda.pdf', contentType: 'application/pdf' })
      .expect(200);

    expect(mailboxManager.sendReply).toHaveBeenCalledWith('user-1', expect.objectContaining({
      attachments: [
        expect.objectContaining({ filename: 'notes.txt', contentType: 'text/plain', content: expect.any(Buffer) }),
        expect.objectContaining({ filename: 'agenda.pdf', contentType: 'application/pdf', content: expect.any(Buffer) }),
      ],
    }));
  });
});
