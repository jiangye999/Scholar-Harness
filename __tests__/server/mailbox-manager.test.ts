import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MailboxManager,
  normalizeAgentMailSearchQuery,
  normalizeMailText,
  normalizeParsedMailText,
  type CachedMailMessage,
} from '../../src/server/services/mailbox-manager';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('MailboxManager local mailbox scope', () => {
  it('treats generic mailbox overview labels as recent-mail requests', () => {
    expect(normalizeAgentMailSearchQuery('最近邮件概览')).toEqual({
      requestedQuery: '最近邮件概览',
      query: '',
      mode: 'recent',
    });
    expect(normalizeAgentMailSearchQuery('看一下我的邮件内容').mode).toBe('recent');
    expect(normalizeAgentMailSearchQuery('recent email overview').mode).toBe('recent');
    expect(normalizeAgentMailSearchQuery('QWeather 账单')).toEqual({
      requestedQuery: 'QWeather 账单',
      query: 'QWeather 账单',
      mode: 'search',
    });
  });

  it('converts HTML mail bodies and malformed HTML text/plain parts to readable text', () => {
    const gatewayBody = '<HTML><BODY>sjs@cau.edu.cn，您好：<br><br>'
      + '以下是 CACTER 邮件安全网关 &amp; 测试。<script>alert("unsafe")</script></BODY></HTML>';

    expect(normalizeMailText(gatewayBody)).toBe(
      'sjs@cau.edu.cn，您好：\n\n以下是 CACTER 邮件安全网关 & 测试。',
    );
    expect(normalizeParsedMailText(gatewayBody, '<p>不应覆盖 text/plain</p>')).not.toContain('<HTML>');
    expect(normalizeParsedMailText('', '<p>仅有 HTML 正文</p>')).toBe('仅有 HTML 正文');
    expect(normalizeMailText('数学表达式 2 < 3，保持为普通文本。')).toBe('数学表达式 2 < 3，保持为普通文本。');
    expect(normalizeMailText('<p>请打开 <a href="https://example.com/paper?id=42">论文页面</a></p>'))
      .toContain('https://example.com/paper?id=42');
  });

  it('lets an authenticated Agent search and read the existing device-local mailbox', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-mailbox-'));
    temporaryRoots.push(dataDir);
    const legacyRoot = path.join(dataDir, 'email-workspace', 'web-user');
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRoot, 'accounts.json'), JSON.stringify([{
      id: 'account-1', provider: 'custom', email: 'user@example.com', displayName: 'Work Mail',
      encryptedCredential: 'unused-in-read-test', imapHost: 'imap.example.com', imapPort: 993,
      imapSecure: true, smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
      createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-03T08:00:00.000Z',
    }]), 'utf8');
    const message: CachedMailMessage = {
      id: 'account-1:42', accountId: 'account-1', uid: 42, messageId: '<weather-bill@example.com>',
      replyToAddress: 'billing@example.com', references: [], subject: '和风天气年度账单',
      from: 'QWeather Billing <billing@example.com>', to: 'user@example.com',
      date: '2026-08-03T08:30:00.000Z', text: 'Invoice and payment receipt are attached.',
      snippet: 'Invoice and payment receipt are attached.', seen: true, folder: 'inbox',
      contentLoaded: true, bodyTextVersion: 2, attachmentsLoaded: true, attachments: [],
    };
    await fs.writeFile(path.join(legacyRoot, 'messages.json'), JSON.stringify([message]), 'utf8');

    const manager = new MailboxManager(dataDir);
    const results = await manager.searchMessages('authenticated-user-id', { query: 'QWeather 账单', limit: 12 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: message.id, accountEmail: 'user@example.com' });
    await expect(manager.getSearchStats('authenticated-user-id')).resolves.toEqual({
      total: 1,
      inbox: 1,
      unread: 0,
      accounts: 1,
    });

    const loaded = await manager.getMessage('authenticated-user-id', 'account-1', message.id);
    expect(loaded.subject).toBe('和风天气年度账单');

    const graph = await manager.buildWikiGraph('authenticated-user-id');
    expect(graph.counts.messages).toBe(1);
    await expect(fs.stat(path.join(legacyRoot, 'email-wiki.json'))).resolves.toBeTruthy();
  });

  it('repairs an already cached HTML body when the message is opened again', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-mailbox-html-'));
    temporaryRoots.push(dataDir);
    const legacyRoot = path.join(dataDir, 'email-workspace', 'web-user');
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRoot, 'accounts.json'), JSON.stringify([{
      id: 'account-1', provider: 'custom', email: 'user@example.com', displayName: 'Work Mail',
      encryptedCredential: 'unused-in-read-test', imapHost: 'imap.example.com', imapPort: 993,
      imapSecure: true, smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
      createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-03T08:00:00.000Z',
    }]), 'utf8');
    const message: CachedMailMessage = {
      id: 'account-1:43', accountId: 'account-1', uid: 43, messageId: '<gateway@example.com>',
      replyToAddress: 'gateway@example.com', references: [], subject: 'Spam notification Abstract',
      from: 'postmaster@example.com', to: 'user@example.com', date: '2026-08-03T08:30:00.000Z',
      text: '<HTML><BODY>隔离区通知<br><br>共 1 封邮件。</BODY></HTML>',
      snippet: '<HTML><BODY>隔离区通知', seen: true, folder: 'inbox', contentLoaded: true,
      bodyTextVersion: 2, attachmentsLoaded: true, attachments: [],
    };
    await fs.writeFile(path.join(legacyRoot, 'messages.json'), JSON.stringify([message]), 'utf8');

    const manager = new MailboxManager(dataDir);
    const loaded = await manager.getMessage('authenticated-user-id', 'account-1', message.id);
    expect(loaded.text).toBe('隔离区通知\n\n共 1 封邮件。');
    expect(loaded.snippet).toBe('隔离区通知 共 1 封邮件。');

    const persisted = JSON.parse(await fs.readFile(path.join(legacyRoot, 'messages.json'), 'utf8')) as CachedMailMessage[];
    expect(persisted[0].text).toBe(loaded.text);
    expect(persisted[0].text).not.toContain('<HTML>');
  });
});
