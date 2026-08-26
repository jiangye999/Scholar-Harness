import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer = require('nodemailer/lib/mail-composer');

type HtmlToTextConverter = (html: string, options?: Record<string, unknown>) => string;
const { convert: convertHtmlToText } = require('html-to-text') as { convert: HtmlToTextConverter };

import { decrypt, encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';

export type MailProvider = 'gmail' | 'outlook' | 'qq' | '163' | 'school' | 'custom';
export type MailFolder = 'inbox' | 'drafts' | 'sent';

function normalizeMailFolder(value: unknown): MailFolder {
  return value === 'drafts' || value === 'sent' ? value : 'inbox';
}

export interface MailAccountInput {
  provider: MailProvider;
  email: string;
  displayName?: string;
  credential: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

interface StoredMailAccount {
  id: string;
  provider: MailProvider;
  email: string;
  displayName: string;
  encryptedCredential: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicMailAccount {
  id: string;
  provider: MailProvider;
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  connectionStatus: 'offline' | 'connecting' | 'connected' | 'error';
  lastSyncAt?: string;
  error?: string;
}

export interface CachedMailMessage {
  id: string;
  accountId: string;
  uid: number;
  messageId: string;
  replyToAddress: string;
  references: string[];
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  snippet: string;
  seen: boolean;
  folder?: MailFolder;
  mailboxPath?: string;
  contentLoaded?: boolean;
  /** Plain-text normalization version, used to repair caches when link handling changes. */
  bodyTextVersion?: number;
  attachmentsLoaded?: boolean;
  attachments?: CachedMailAttachment[];
  /** True until this locally-recorded outgoing message is reconciled with IMAP Sent. */
  localOnly?: boolean;
  archiveStatus?: 'pending' | 'archived' | 'failed';
}

export interface SendReplyResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  recordedLocally: boolean;
  archivedToServer: boolean;
  archiveWarning?: string;
  sentMessage?: CachedMailMessage;
}

export interface CachedMailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition?: string;
  contentId?: string;
  related?: boolean;
  available: boolean;
  error?: string;
  /** Internal relative path. It is removed before the message reaches the renderer. */
  storageKey?: string;
  /** Local desktop preview fields, computed only when returning one message. */
  previewPath?: string;
  previewRoot?: string;
}

export interface ResolvedMailAttachment {
  filePath: string;
  filename: string;
  contentType: string;
  size: number;
}

interface ParsedIncomingAttachment {
  filename?: string | false;
  contentType?: string;
  contentDisposition?: string;
  cid?: string;
  related?: boolean;
  content?: Buffer;
  size?: number;
}

export interface MailboxSummary {
  total: number;
  unread: number;
  read: number;
  accounts: Array<{ accountId: string; total: number; unread: number }>;
}

export interface MailSearchOptions {
  query: string;
  accountId?: string;
  sender?: string;
  unreadOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface MailSearchResult {
  id: string;
  accountId: string;
  accountEmail: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  seen: boolean;
  contentLoaded: boolean;
  score: number;
}

export interface MailSearchStats {
  total: number;
  inbox: number;
  unread: number;
  accounts: number;
}

export interface AgentMailSearchQuery {
  requestedQuery: string;
  query: string;
  mode: 'recent' | 'search';
}

export interface EmailWikiQueryOptions {
  query?: string;
  nodeType?: EmailWikiGraph['nodes'][number]['type'];
  limit?: number;
}

export interface EmailWikiGraph {
  generatedAt: string;
  counts: { accounts: number; senders: number; messages: number; keywords: number };
  nodes: Array<{
    id: string;
    type: 'account' | 'sender' | 'message' | 'keyword';
    label: string;
    subtitle?: string;
    weight: number;
    unread?: boolean;
    messageId?: string;
    accountId?: string;
  }>;
  links: Array<{ source: string; target: string; type: 'owns' | 'sent' | 'keyword' }>;
}

type MailboxEvent =
  | { type: 'account-status'; accountId: string; status: PublicMailAccount['connectionStatus']; error?: string }
  | { type: 'messages-updated'; accountId: string; count: number; syncedAt: string }
  | { type: 'message-body-updated'; accountId: string; messageId: string; syncedAt: string };

interface AccountRuntime {
  client: ImapFlow | null;
  status: PublicMailAccount['connectionStatus'];
  lastSyncAt?: string;
  error?: string;
  syncing: boolean;
  syncPromise?: Promise<number>;
  syncRequestLimit?: number;
  connectPromise?: Promise<void>;
  stopped: boolean;
  reconnectTimer?: NodeJS.Timeout;
}

type PresetMailProvider = Exclude<MailProvider, 'custom' | 'school'>;

const PROVIDERS: Record<PresetMailProvider, {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}> = {
  gmail: {
    imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
  },
  outlook: {
    imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp-mail.outlook.com', smtpPort: 587, smtpSecure: false,
  },
  qq: {
    imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
  },
  '163': {
    imapHost: 'imap.163.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.163.com', smtpPort: 465, smtpSecure: true,
  },
};

function providerPreset(provider: MailProvider) {
  return provider === 'custom' || provider === 'school' ? null : PROVIDERS[provider];
}

const INITIAL_MESSAGE_LIMIT = 0;
const MESSAGE_BODY_FETCH_TIMEOUT_MS = 25_000;
const MESSAGE_PARSE_TIMEOUT_MS = 8_000;
const INITIAL_SYNC_DELAY_MS = 350;
const MAX_INCOMING_ATTACHMENTS = 50;
const MAX_INCOMING_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_INCOMING_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_OUTGOING_ATTACHMENTS = 20;
const MAX_OUTGOING_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_OUTGOING_ATTACHMENTS_TOTAL_BYTES = 50 * 1024 * 1024;

function safeAttachmentFilename(value: unknown, fallback = 'attachment.bin'): string {
  const basename = path.basename(String(value || '').replace(/\0/g, '').trim() || fallback);
  const cleaned = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 160);
  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeAddressList(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const addresses = (value as { value?: Array<{ name?: string; address?: string }> }).value;
  if (!Array.isArray(addresses)) return '';
  return addresses
    .map(item => item.name ? `${item.name} <${item.address || ''}>` : String(item.address || ''))
    .filter(Boolean)
    .join(', ');
}

const MAIL_HTML_MARKUP_PATTERN = /<(?:!doctype|html|head|body|title|meta|style|script|noscript|p|div|span|br|hr|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|a|img)\b[^>]*>/i;
const MAIL_BODY_TEXT_VERSION = 2;

/**
 * Normalize every message body to safe, readable plain text before it reaches
 * the cache, search index, Wiki graph, AI context, or renderer. Some gateways
 * incorrectly put a complete HTML document inside a text/plain MIME part, so
 * choosing parsed.text alone is not sufficient.
 */
export function normalizeMailText(value: unknown): string {
  let text = String(value || '');
  if (MAIL_HTML_MARKUP_PATTERN.test(text)) {
    try {
      text = convertHtmlToText(text, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
          { selector: 'head', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'noscript', format: 'skip' },
          { selector: 'img', format: 'skip' },
          // Keep the destination in the resulting plain text. The renderer
          // independently linkifies only HTTP(S), so unsafe schemes remain text.
          { selector: 'a', options: { ignoreHref: false } },
        ],
      });
    } catch (error) {
      logger.warn('[Mailbox] HTML-to-text conversion failed; using conservative tag stripping.', error);
      text = text
        .replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, '')
        .replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, '\n')
        .replace(/<\/(?:p|div|tr|li|table|h[1-6])\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    }
  }
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, 120_000);
}

export function normalizeParsedMailText(textValue: unknown, htmlValue: unknown): string {
  const text = normalizeMailText(textValue);
  return text || normalizeMailText(htmlValue);
}

/**
 * IMAP servers occasionally return malformed Date headers.  Never let one bad
 * message abort an account-wide sync: try every trusted fallback and finally
 * use the current time so the cached message remains sortable and readable.
 */
export function normalizeMailDate(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    let timestamp = Number.NaN;
    if (candidate instanceof Date) {
      timestamp = candidate.getTime();
    } else if (typeof candidate === 'number') {
      timestamp = candidate;
    } else if (typeof candidate === 'string' && candidate.trim()) {
      timestamp = Date.parse(candidate);
    }
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return new Date().toISOString();
}

function firstAddress(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const addresses = (value as { value?: Array<{ address?: string }> }).value;
  return Array.isArray(addresses) ? String(addresses[0]?.address || '').trim().toLowerCase() : '';
}

function normalizeEnvelopeAddressList(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const address = String((item as { address?: string }).address || '').trim();
      const name = String((item as { name?: string }).name || '').trim();
      return name ? `${name} <${address}>` : address;
    })
    .filter(Boolean)
    .join(', ');
}

function firstEnvelopeAddress(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const item = value.find(candidate => candidate && typeof candidate === 'object') as { address?: string } | undefined;
  return String(item?.address || '').trim().toLowerCase();
}

function normalizedReferences(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  return candidates.map(item => String(item || '').trim()).filter(Boolean).slice(0, 100);
}

function canonicalMessageId(value: unknown): string {
  return String(value || '').trim().replace(/^<|>$/g, '').toLowerCase();
}

function sentMessageCacheKey(message: CachedMailMessage): string {
  const messageId = canonicalMessageId(message.messageId);
  return messageId
    ? `${message.accountId}:sent:${messageId}`
    : `${message.accountId}:sent:id:${message.id}`;
}

/**
 * Reconcile local SMTP records with messages later discovered in IMAP Sent.
 * The IMAP identity wins, while locally-cached body and attachments are kept.
 */
function deduplicateSentMessages(messages: CachedMailMessage[]): CachedMailMessage[] {
  const passthrough: CachedMailMessage[] = [];
  const sent = new Map<string, CachedMailMessage>();
  messages.forEach(message => {
    if (normalizeMailFolder(message.folder) !== 'sent') {
      passthrough.push(message);
      return;
    }
    const key = sentMessageCacheKey(message);
    const previous = sent.get(key);
    if (!previous) {
      sent.set(key, message);
      return;
    }
    const preferred = previous.localOnly === true && message.localOnly !== true ? message : previous;
    const fallback = preferred === previous ? message : previous;
    sent.set(key, {
      ...fallback,
      ...preferred,
      text: preferred.text || fallback.text,
      snippet: preferred.snippet || fallback.snippet,
      references: preferred.references?.length ? preferred.references : fallback.references,
      contentLoaded: preferred.contentLoaded === true || fallback.contentLoaded === true,
      attachmentsLoaded: preferred.attachmentsLoaded === true || fallback.attachmentsLoaded === true,
      attachments: preferred.attachments?.length ? preferred.attachments : fallback.attachments,
    });
  });
  return [...passthrough, ...sent.values()]
    .sort((left, right) => right.date.localeCompare(left.date));
}

function validateSingleAddress(value: unknown): string {
  const address = String(value || '').trim().toLowerCase();
  if (address.length > 320 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address)) {
    throw new Error('收件人邮箱地址无效。');
  }
  return address;
}

const EMAIL_WIKI_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'are', 'was', 'were', 'have', 'has',
  're', 'fw', 'fwd', '邮件', '通知', '回复', '您好', '你好', '谢谢', '关于', '我们', '你们', '一个', '这个', '进行',
]);

function extractEmailWikiKeywords(value: string): string[] {
  const text = String(value || '').toLowerCase();
  const english = text.match(/[a-z][a-z0-9-]{2,30}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return [...english, ...chinese]
    .map(token => token.trim())
    .filter(token => !EMAIL_WIKI_STOPWORDS.has(token))
    .filter((token, index, all) => all.indexOf(token) === index)
    .slice(0, 8);
}

function normalizeSearchText(value: unknown): string {
  return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A request such as "看一下我的邮件" asks for the recent mailbox, not for a
 * literal message containing those words.  Agent models may still place a
 * generated label such as "最近邮件概览" in `query`; normalize that label to an
 * empty search so the regular date-descending result order returns recent mail.
 */
export function normalizeAgentMailSearchQuery(value: unknown): AgentMailSearchQuery {
  const requestedQuery = String(value || '').trim().slice(0, 2_000);
  const normalized = normalizeSearchText(requestedQuery);
  const compactChinese = normalized.replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]]+/g, '');
  const genericChineseRequest = /^(?:请)?(?:帮我)?(?:看|查看|看看|看一下|浏览|列出|展示|概览|总结)?(?:一下)?(?:我|我的|当前|最近|最新|近期)?(?:的)?(?:邮件|邮箱|收件箱)(?:内容|概览|列表|情况|摘要)?$/.test(compactChinese);
  const genericEnglishRequest = /^(?:show|view|list|check|summarize)?\s*(?:my\s+)?(?:recent\s+|latest\s+)?(?:email|emails|mail|inbox)(?:\s+(?:overview|summary|list|content))?$/.test(normalized);
  if (genericChineseRequest || genericEnglishRequest) {
    return { requestedQuery, query: '', mode: 'recent' };
  }
  return { requestedQuery, query: requestedQuery, mode: requestedQuery ? 'search' : 'recent' };
}

function emailSearchTokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const latin = normalized.match(/[a-z0-9][a-z0-9._@+-]{1,80}/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,16}/g) || [];
  return Array.from(new Set([...latin, ...chinese])).slice(0, 24);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      try { onTimeout?.(); } catch { /* timeout cleanup must not hide the original error */ }
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class MailboxManager {
  private readonly dataDir: string;
  private readonly runtimes = new Map<string, AccountRuntime>();
  private readonly subscribers = new Map<string, Set<(event: MailboxEvent) => void>>();
  private readonly messageLoadPromises = new Map<string, Promise<CachedMailMessage>>();
  private readonly attachmentLoadPromises = new Map<string, Promise<void>>();
  private readonly mailboxScopeFallbackNotices = new Set<string>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private userRoot(userIdInput: unknown): string {
    return path.join(this.dataDir, 'email-workspace', sanitizeUserId(userIdInput || 'web-user'));
  }

  private accountPath(userIdInput: unknown): string {
    return path.join(this.userRoot(userIdInput), 'accounts.json');
  }

  private messagesPath(userIdInput: unknown): string {
    return path.join(this.userRoot(userIdInput), 'messages.json');
  }

  private attachmentsRoot(userIdInput: unknown): string {
    return path.join(this.userRoot(userIdInput), 'attachments');
  }

  private attachmentMessageRoot(userIdInput: unknown, messageId: string): string {
    const messageKey = createHash('sha256').update(String(messageId || '')).digest('hex').slice(0, 32);
    return path.join(this.attachmentsRoot(userIdInput), messageKey);
  }

  private wikiPath(userIdInput: unknown): string {
    return path.join(this.userRoot(userIdInput), 'email-wiki.json');
  }

  /**
   * Mailbox data predates authenticated desktop sessions and was historically
   * stored under `web-user`. Keep that device-local mailbox available to the
   * formal Agent tools until a session-specific mailbox directory actually
   * exists. This avoids an empty Agent database while the inbox UI is showing
   * the legacy local cache, without merging two real user directories.
   */
  private async resolveMailboxDataUserId(userIdInput: unknown): Promise<string> {
    const requestedUserId = sanitizeUserId(userIdInput || 'web-user');
    if (requestedUserId === 'web-user') return requestedUserId;

    const requestedRoot = this.userRoot(requestedUserId);
    const requestedExists = await fs.stat(requestedRoot)
      .then(stat => stat.isDirectory())
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
    if (requestedExists) return requestedUserId;

    const legacyRoot = this.userRoot('web-user');
    const legacyExists = await fs.stat(legacyRoot)
      .then(stat => stat.isDirectory())
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
    if (!legacyExists) return requestedUserId;

    if (!this.mailboxScopeFallbackNotices.has(requestedUserId)) {
      this.mailboxScopeFallbackNotices.add(requestedUserId);
      logger.info(`[Mailbox] Using legacy device-local mailbox scope for session ${requestedUserId}.`);
    }
    return 'web-user';
  }

  private runtimeKey(userIdInput: unknown, accountId: string): string {
    return `${sanitizeUserId(userIdInput || 'web-user')}:${accountId}`;
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[Mailbox] Failed to read local mailbox state:', error);
      }
      return fallback;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  private async readAccounts(userId: unknown): Promise<StoredMailAccount[]> {
    const accounts = await this.readJson<StoredMailAccount[]>(this.accountPath(userId), []);
    return Array.isArray(accounts) ? accounts : [];
  }

  private resolveInput(input: MailAccountInput): Omit<StoredMailAccount, 'id' | 'encryptedCredential' | 'createdAt' | 'updatedAt'> {
    const provider = input.provider;
    const preset = providerPreset(provider);
    const email = String(input.email || '').trim();
    const host = String(preset?.imapHost || input.imapHost || '').trim();
    const port = Number(preset?.imapPort || input.imapPort || 0);
    const secure = preset ? preset.imapSecure : input.imapSecure !== false;
    const smtpHost = String(preset?.smtpHost || input.smtpHost || '').trim();
    const smtpPort = Number(preset?.smtpPort || input.smtpPort || 0);
    const smtpSecure = preset ? preset.smtpSecure : input.smtpSecure !== false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的邮箱地址。');
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('请输入有效的 IMAP 服务器地址。');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IMAP 端口无效。');
    if (!smtpHost || !/^[a-z0-9.-]+$/i.test(smtpHost)) throw new Error('请输入有效的 SMTP 服务器地址。');
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('SMTP 端口无效。');
    if (!String(input.credential || '').trim()) throw new Error('请输入邮箱授权码、应用专用密码或访问令牌。');
    return {
      provider,
      email,
      displayName: String(input.displayName || email).trim().slice(0, 80),
      imapHost: host,
      imapPort: port,
      imapSecure: secure,
      smtpHost,
      smtpPort,
      smtpSecure,
    };
  }

  private createClient(account: StoredMailAccount): ImapFlow {
    return new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: {
        user: account.email,
        pass: decrypt(account.encryptedCredential),
      },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      tls: { rejectUnauthorized: true },
    });
  }

  private emit(userId: unknown, event: MailboxEvent): void {
    const key = sanitizeUserId(userId || 'web-user');
    this.subscribers.get(key)?.forEach(listener => {
      try { listener(event); } catch { /* subscriber owns its response lifecycle */ }
    });
  }

  subscribe(userId: unknown, listener: (event: MailboxEvent) => void): () => void {
    const key = sanitizeUserId(userId || 'web-user');
    const listeners = this.subscribers.get(key) || new Set<(event: MailboxEvent) => void>();
    listeners.add(listener);
    this.subscribers.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.subscribers.delete(key);
    };
  }

  private toPublic(userId: unknown, account: StoredMailAccount): PublicMailAccount {
    const runtime = this.runtimes.get(this.runtimeKey(userId, account.id));
    return {
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost || providerPreset(account.provider)?.smtpHost || '',
      smtpPort: account.smtpPort || providerPreset(account.provider)?.smtpPort || 0,
      smtpSecure: account.smtpSecure ?? providerPreset(account.provider)?.smtpSecure ?? true,
      connectionStatus: runtime?.status || 'offline',
      lastSyncAt: runtime?.lastSyncAt,
      error: runtime?.error,
    };
  }

  async listAccounts(userId: unknown, connect = true): Promise<PublicMailAccount[]> {
    const accounts = await this.readAccounts(userId);
    if (connect) {
      accounts.forEach(account => void this.ensureConnected(userId, account));
    }
    return accounts.map(account => this.toPublic(userId, account));
  }

  async addAccount(userId: unknown, input: MailAccountInput): Promise<PublicMailAccount> {
    const resolved = this.resolveInput(input);
    const now = new Date().toISOString();
    const account: StoredMailAccount = {
      ...resolved,
      id: randomUUID(),
      encryptedCredential: encrypt(String(input.credential).trim()),
      createdAt: now,
      updatedAt: now,
    };
    const testClient = this.createClient(account);
    try {
      await testClient.connect();
      await testClient.mailboxOpen('INBOX', { readOnly: true });
    } finally {
      try { await testClient.logout(); } catch { try { testClient.close(); } catch { /* no-op */ } }
    }
    const accounts = await this.readAccounts(userId);
    if (accounts.some(item => item.email.toLowerCase() === account.email.toLowerCase() && item.imapHost === account.imapHost)) {
      throw new Error('该邮箱账户已经添加。');
    }
    accounts.push(account);
    await this.writeJson(this.accountPath(userId), accounts);
    void this.ensureConnected(userId, account);
    return this.toPublic(userId, account);
  }

  async removeAccount(userId: unknown, accountId: string): Promise<void> {
    const accounts = await this.readAccounts(userId);
    const nextAccounts = accounts.filter(account => account.id !== accountId);
    if (nextAccounts.length === accounts.length) throw new Error('邮箱账户不存在。');
    await this.writeJson(this.accountPath(userId), nextAccounts);
    const key = this.runtimeKey(userId, accountId);
    const runtime = this.runtimes.get(key);
    if (runtime) {
      runtime.stopped = true;
      if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
      try { await runtime.client?.logout(); } catch { try { runtime.client?.close(); } catch { /* no-op */ } }
      this.runtimes.delete(key);
    }
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const removedMessages = messages.filter(message => message.accountId === accountId);
    await this.writeJson(this.messagesPath(userId), messages.filter(message => message.accountId !== accountId));
    await Promise.allSettled(removedMessages.map(message => fs.rm(
      this.attachmentMessageRoot(userId, message.id),
      { recursive: true, force: true },
    )));
  }

  private async findAccount(userId: unknown, accountId: string): Promise<StoredMailAccount> {
    const account = (await this.readAccounts(userId)).find(item => item.id === accountId);
    if (!account) throw new Error('邮箱账户不存在。');
    return account;
  }

  async ensureConnected(userId: unknown, accountOrId: StoredMailAccount | string): Promise<void> {
    const account = typeof accountOrId === 'string' ? await this.findAccount(userId, accountOrId) : accountOrId;
    const key = this.runtimeKey(userId, account.id);
    const existing = this.runtimes.get(key);
    if (existing?.status === 'connected') return;
    if (existing?.status === 'connecting' && existing.connectPromise) {
      await existing.connectPromise;
      return;
    }
    const runtime: AccountRuntime = existing || { client: null, status: 'offline', syncing: false, stopped: false };
    runtime.status = 'connecting';
    runtime.error = undefined;
    runtime.stopped = false;
    this.runtimes.set(key, runtime);
    this.emit(userId, { type: 'account-status', accountId: account.id, status: 'connecting' });
    const client = this.createClient(account);
    runtime.client = client;
    const reconnect = (error?: unknown) => {
      if (runtime.stopped) return;
      runtime.status = 'error';
      runtime.error = error ? String((error as Error).message || error) : '邮箱连接已断开，正在重连。';
      this.emit(userId, { type: 'account-status', accountId: account.id, status: 'error', error: runtime.error });
      if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = setTimeout(() => {
        runtime.status = 'offline';
        void this.ensureConnected(userId, account);
      }, 15_000);
    };
    client.on('error', reconnect);
    client.on('close', () => reconnect());
    client.on('exists', () => void this.syncAccount(userId, account.id, 20));
    const connectPromise = (async () => {
      try {
        await client.connect();
        // The mailbox must be writable so opening an unread message can persist
        // the IMAP \\Seen flag instead of only changing local presentation state.
        await client.mailboxOpen('INBOX');
        runtime.status = 'connected';
        runtime.error = undefined;
        this.emit(userId, { type: 'account-status', accountId: account.id, status: 'connected' });
        // Connecting and synchronizing are separate lifecycle stages. Waiting
        // for a full mailbox scan here made every body request that arrived
        // during startup wait behind hundreds of envelope reads.
        setTimeout(() => {
          void this.syncAccount(userId, account.id, INITIAL_MESSAGE_LIMIT).catch(error => {
            logger.warn(`[Mailbox] Initial sync failed for ${account.email}:`, error);
          });
        }, INITIAL_SYNC_DELAY_MS);
      } catch (error) {
        try { client.close(); } catch { /* no-op */ }
        reconnect(error);
      }
    })();
    runtime.connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (runtime.connectPromise === connectPromise) runtime.connectPromise = undefined;
    }
  }

  async syncAccount(userId: unknown, accountId: string, limit = INITIAL_MESSAGE_LIMIT): Promise<number> {
    const account = await this.findAccount(userId, accountId);
    const key = this.runtimeKey(userId, account.id);
    await this.ensureConnected(userId, account);
    const runtime = this.runtimes.get(key);
    if (!runtime?.client || runtime.status !== 'connected') return 0;
    if (runtime.syncPromise) {
      const activeLimit = runtime.syncRequestLimit;
      const activeCount = await runtime.syncPromise;
      // A manual refresh is a strict full sync. If it arrived while the IDLE
      // handler was only fetching recent messages, wait for that small job and
      // then run the full mailbox pass instead of silently reusing it.
      if (Number(limit) === 0 && activeLimit !== 0) {
        return activeCount + await this.syncAccount(userId, accountId, 0);
      }
      return activeCount;
    }
    const syncPromise = this.syncAccountMetadata(userId, account, runtime, limit);
    runtime.syncPromise = syncPromise;
    runtime.syncRequestLimit = Number(limit);
    runtime.syncing = true;
    try {
      return await syncPromise;
    } finally {
      runtime.syncing = false;
      if (runtime.syncPromise === syncPromise) {
        runtime.syncPromise = undefined;
        runtime.syncRequestLimit = undefined;
      }
    }
  }

  async syncFolder(
    userId: unknown,
    accountId: string,
    folder: MailFolder,
    limit = INITIAL_MESSAGE_LIMIT,
  ): Promise<number> {
    const normalizedFolder = normalizeMailFolder(folder);
    if (normalizedFolder === 'inbox') return this.syncAccount(userId, accountId, limit);

    const account = await this.findAccount(userId, accountId);
    const client = this.createClient(account);
    try {
      await client.connect();
      const mailboxPath = await this.resolveMailboxPath(client, normalizedFolder);
      await client.mailboxOpen(mailboxPath, { readOnly: true });
      return await this.syncSecondaryFolderMetadata(userId, account, client, normalizedFolder, mailboxPath, limit);
    } finally {
      try { await client.logout(); } catch { try { client.close(); } catch { /* no-op */ } }
    }
  }

  private async resolveMailboxPath(client: ImapFlow, folder: MailFolder): Promise<string> {
    if (folder === 'inbox') return 'INBOX';
    const mailboxes = await client.list();
    const specialUse = folder === 'drafts' ? '\\Drafts' : '\\Sent';
    const bySpecialUse = mailboxes.find(item => String(item.specialUse || '').toLowerCase() === specialUse.toLowerCase());
    if (bySpecialUse?.path) return bySpecialUse.path;

    const aliases = folder === 'drafts'
      ? ['draft', 'drafts', '草稿', '草稿箱', 'entwürfe', 'brouillons', 'bozze']
      : ['sent', 'sent mail', 'sent items', '已发送', '发件箱', '已发邮件', 'gesendet', 'envoyés', 'inviata'];
    const byName = mailboxes.find(item => {
      const candidate = `${item.name || ''} ${item.path || ''}`.toLowerCase();
      return aliases.some(alias => candidate.includes(alias));
    });
    if (byName?.path) return byName.path;
    throw new Error(folder === 'drafts' ? '邮箱服务器未提供草稿箱。' : '邮箱服务器未提供已发送文件夹。');
  }

  private async syncSecondaryFolderMetadata(
    userId: unknown,
    account: StoredMailAccount,
    client: ImapFlow,
    folder: Exclude<MailFolder, 'inbox'>,
    mailboxPath: string,
    limit: number,
  ): Promise<number> {
    const result = await client.search({ all: true }, { uid: true });
    const allUids = Array.isArray(result)
      ? result.filter(uid => Number.isInteger(uid) && uid > 0).sort((left, right) => left - right)
      : [];
    const requested = Number(limit);
    const selectedUids = requested > 0 ? allUids.slice(-Math.max(1, requested)) : allUids;
    const current = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const merged = new Map<string, CachedMailMessage>();
    const validIds = new Set(allUids.map(uid => `${account.id}:${folder}:${uid}`));
    current.forEach(message => {
      if (message.accountId !== account.id || normalizeMailFolder(message.folder) !== folder
        || requested > 0 || validIds.has(message.id) || message.localOnly === true) {
        merged.set(message.id, message);
      }
    });
    const sentIdsByMessageId = new Map<string, string>();
    merged.forEach(message => {
      const key = canonicalMessageId(message.messageId);
      if (message.accountId === account.id && normalizeMailFolder(message.folder) === folder && key) {
        sentIdsByMessageId.set(key, message.id);
      }
    });

    let fetchedCount = 0;
    const persistProgress = async (): Promise<void> => {
      // A send can finish while a large folder sync is running. Re-read the
      // cache before every batch so that newly persisted local Sent records
      // are never overwritten by an older in-memory snapshot.
      const latest = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
      latest.forEach(message => {
        const belongsToFolder = message.accountId === account.id && normalizeMailFolder(message.folder) === folder;
        if (!belongsToFolder || requested > 0 || validIds.has(message.id) || message.localOnly === true) {
          if (!merged.has(message.id)) merged.set(message.id, message);
        }
      });
      const next = deduplicateSentMessages(Array.from(merged.values()));
      await this.writeJson(this.messagesPath(userId), next);
      this.emit(userId, { type: 'messages-updated', accountId: account.id, count: fetchedCount, syncedAt: new Date().toISOString() });
    };
    const batchSize = 250;
    for (let offset = 0; offset < selectedUids.length; offset += batchSize) {
      const batch = selectedUids.slice(offset, offset + batchSize);
      for await (const message of client.fetch(batch.join(','), {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true })) {
        if (!message.uid) continue;
        const id = `${account.id}:${folder}:${message.uid}`;
        const envelope = message.envelope;
        const serverMessageId = String(envelope?.messageId || '');
        const canonicalId = canonicalMessageId(serverMessageId);
        const duplicateId = canonicalId ? sentIdsByMessageId.get(canonicalId) : undefined;
        const existing = merged.get(id) || (duplicateId ? merged.get(duplicateId) : undefined);
        if (duplicateId && duplicateId !== id) merged.delete(duplicateId);
        merged.set(id, {
          id,
          accountId: account.id,
          uid: message.uid,
          messageId: serverMessageId || existing?.messageId || '',
          replyToAddress: firstEnvelopeAddress(envelope?.replyTo) || firstEnvelopeAddress(envelope?.from) || existing?.replyToAddress || '',
          references: existing?.references || [],
          subject: String(envelope?.subject || existing?.subject || '（无主题）').slice(0, 500),
          from: normalizeEnvelopeAddressList(envelope?.from) || existing?.from || '',
          to: normalizeEnvelopeAddressList(envelope?.to) || existing?.to || '',
          date: normalizeMailDate(envelope?.date, message.internalDate, existing?.date),
          text: existing?.text || '',
          snippet: existing?.snippet || '',
          seen: true,
          folder,
          mailboxPath,
          contentLoaded: existing?.contentLoaded ?? Boolean(existing?.text),
          attachmentsLoaded: existing?.attachmentsLoaded ?? false,
          attachments: existing?.attachments || [],
          localOnly: false,
          archiveStatus: 'archived',
        });
        if (canonicalId) sentIdsByMessageId.set(canonicalId, id);
        fetchedCount += 1;
      }
      await persistProgress();
    }
    if (!selectedUids.length) await persistProgress();
    return fetchedCount;
  }

  private async syncAccountMetadata(
    userId: unknown,
    account: StoredMailAccount,
    runtime: AccountRuntime,
    limit: number,
  ): Promise<number> {
    const client = runtime.client;
    if (!client) return 0;
    const result = await client.search({ all: true }, { uid: true });
    const allUids = Array.isArray(result)
      ? result.filter(uid => Number.isInteger(uid) && uid > 0).sort((left, right) => left - right)
      : [];
    const requested = Number(limit);
    const selectedUids = requested > 0 ? allUids.slice(-Math.max(1, requested)) : allUids;
    const current = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const merged = new Map<string, CachedMailMessage>();
    const validAccountIds = new Set(allUids.map(uid => `${account.id}:${uid}`));
    current.forEach(message => {
      if (message.accountId !== account.id || normalizeMailFolder(message.folder) !== 'inbox' || requested > 0 || validAccountIds.has(message.id)) {
        merged.set(message.id, message);
      }
    });

    let fetchedCount = 0;
    const persistProgress = async (): Promise<void> => {
      const latest = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
      latest.forEach(message => {
        const belongsToInbox = message.accountId === account.id && normalizeMailFolder(message.folder) === 'inbox';
        if (!belongsToInbox || requested > 0 || validAccountIds.has(message.id)) {
          if (!merged.has(message.id)) merged.set(message.id, message);
        }
      });
      const next = deduplicateSentMessages(Array.from(merged.values()));
      await this.writeJson(this.messagesPath(userId), next);
      runtime.lastSyncAt = new Date().toISOString();
      this.emit(userId, {
        type: 'messages-updated',
        accountId: account.id,
        count: fetchedCount,
        syncedAt: runtime.lastSyncAt,
      });
    };

    if (!selectedUids.length) {
      await persistProgress();
      await this.rebuildWikiGraphAfterSync(userId);
      return 0;
    }

    const batchSize = 250;
    for (let offset = 0; offset < selectedUids.length; offset += batchSize) {
      const batch = selectedUids.slice(offset, offset + batchSize);
      for await (const message of client.fetch(batch.join(','), {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true })) {
        if (!message.uid) continue;
        const id = `${account.id}:${message.uid}`;
        const existing = merged.get(id);
        const envelope = message.envelope;
        const from = normalizeEnvelopeAddressList(envelope?.from) || existing?.from || '';
        const to = normalizeEnvelopeAddressList(envelope?.to) || existing?.to || '';
        merged.set(id, {
          id,
          accountId: account.id,
          uid: message.uid,
          messageId: String(envelope?.messageId || existing?.messageId || ''),
          replyToAddress: firstEnvelopeAddress(envelope?.replyTo) || firstEnvelopeAddress(envelope?.from) || existing?.replyToAddress || '',
          references: existing?.references || [],
          subject: String(envelope?.subject || existing?.subject || '（无主题）').slice(0, 500),
          from,
          to,
          date: normalizeMailDate(envelope?.date, message.internalDate, existing?.date),
          text: existing?.text || '',
          snippet: existing?.snippet || '',
          seen: message.flags ? message.flags.has('\\Seen') : !!existing?.seen,
          folder: 'inbox',
          mailboxPath: 'INBOX',
          contentLoaded: existing?.contentLoaded ?? Boolean(existing?.text),
          attachmentsLoaded: existing?.attachmentsLoaded ?? false,
          attachments: existing?.attachments || [],
        });
        fetchedCount += 1;
      }
      // Persist every batch so a large inbox becomes visible progressively and
      // one later malformed message cannot hide all successfully read metadata.
      await persistProgress();
    }
    await this.rebuildWikiGraphAfterSync(userId);
    return fetchedCount;
  }

  private async rebuildWikiGraphAfterSync(userId: unknown): Promise<void> {
    try {
      await this.buildWikiGraph(userId);
    } catch (error) {
      logger.warn('[Mailbox] Failed to rebuild email Wiki graph after sync:', error);
    }
  }

  async listMessages(
    userId: unknown,
    accountId?: string,
    limit = 0,
    folder: MailFolder | 'all' = 'inbox',
  ): Promise<CachedMailMessage[]> {
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const filtered = messages.filter(message => (!accountId || message.accountId === accountId)
      && (folder === 'all' || normalizeMailFolder(message.folder) === folder));
    const requested = Number(limit);
    return requested > 0 ? filtered.slice(0, Math.max(1, requested)) : filtered;
  }

  async getSummary(userId: unknown): Promise<MailboxSummary> {
    const messages = (await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []))
      .filter(message => normalizeMailFolder(message.folder) === 'inbox');
    const byAccount = new Map<string, { accountId: string; total: number; unread: number }>();
    messages.forEach(message => {
      const item = byAccount.get(message.accountId) || { accountId: message.accountId, total: 0, unread: 0 };
      item.total += 1;
      if (!message.seen) item.unread += 1;
      byAccount.set(message.accountId, item);
    });
    const unread = messages.reduce((count, message) => count + (message.seen ? 0 : 1), 0);
    return {
      total: messages.length,
      unread,
      read: messages.length - unread,
      accounts: Array.from(byAccount.values()),
    };
  }

  async getSearchStats(userId: unknown, accountId?: string): Promise<MailSearchStats> {
    const storageUserId = await this.resolveMailboxDataUserId(userId);
    const [accounts, messages] = await Promise.all([
      this.readAccounts(storageUserId),
      this.readJson<CachedMailMessage[]>(this.messagesPath(storageUserId), []),
    ]);
    const scopedMessages = accountId
      ? messages.filter(message => message.accountId === accountId)
      : messages;
    const inboxMessages = scopedMessages.filter(message => normalizeMailFolder(message.folder) === 'inbox');
    return {
      total: scopedMessages.length,
      inbox: inboxMessages.length,
      unread: inboxMessages.filter(message => !message.seen).length,
      accounts: accountId
        ? accounts.filter(account => account.id === accountId).length
        : accounts.length,
    };
  }

  async searchMessages(userId: unknown, options: MailSearchOptions): Promise<MailSearchResult[]> {
    const storageUserId = await this.resolveMailboxDataUserId(userId);
    const [accounts, messages] = await Promise.all([
      this.readAccounts(storageUserId),
      this.readJson<CachedMailMessage[]>(this.messagesPath(storageUserId), []),
    ]);
    const accountEmails = new Map(accounts.map(account => [account.id, account.email]));
    const query = normalizeSearchText(options.query);
    const tokens = emailSearchTokens(query);
    const senderFilter = normalizeSearchText(options.sender);
    const dateFrom = options.dateFrom ? Date.parse(options.dateFrom) : Number.NaN;
    const dateTo = options.dateTo ? Date.parse(options.dateTo) : Number.NaN;
    const limit = Math.max(1, Math.min(50, Number(options.limit || 12) || 12));

    return messages
      .filter(message => !options.accountId || message.accountId === options.accountId)
      .filter(message => options.unreadOnly !== true || !message.seen)
      .filter(message => !senderFilter || normalizeSearchText(message.from).includes(senderFilter))
      .filter(message => {
        const timestamp = Date.parse(message.date);
        if (Number.isFinite(dateFrom) && (!Number.isFinite(timestamp) || timestamp < dateFrom)) return false;
        if (Number.isFinite(dateTo) && (!Number.isFinite(timestamp) || timestamp > dateTo)) return false;
        return true;
      })
      .map(message => {
        const subject = normalizeSearchText(message.subject);
        const from = normalizeSearchText(message.from);
        const to = normalizeSearchText(message.to);
        const body = normalizeSearchText(`${message.snippet}\n${message.text}`);
        let score = 0;
        if (query) {
          if (subject.includes(query)) score += 18;
          if (from.includes(query)) score += 12;
          if (to.includes(query)) score += 6;
          if (body.includes(query)) score += 8;
          for (const token of tokens) {
            if (subject.includes(token)) score += 5;
            if (from.includes(token)) score += 4;
            if (to.includes(token)) score += 2;
            if (body.includes(token)) score += 1;
          }
        }
        return { message, score };
      })
      .filter(item => !query || item.score > 0)
      .sort((left, right) => right.score - left.score || right.message.date.localeCompare(left.message.date))
      .slice(0, limit)
      .map(({ message, score }) => ({
        id: message.id,
        accountId: message.accountId,
        accountEmail: accountEmails.get(message.accountId) || '',
        subject: message.subject,
        from: message.from,
        to: message.to,
        date: message.date,
        snippet: message.snippet || message.text.replace(/\s+/g, ' ').slice(0, 320),
        seen: message.seen,
        contentLoaded: message.contentLoaded === true,
        score,
      }));
  }

  async buildWikiGraph(userId: unknown): Promise<EmailWikiGraph> {
    const storageUserId = await this.resolveMailboxDataUserId(userId);
    const [accounts, messages] = await Promise.all([
      this.readAccounts(storageUserId),
      this.readJson<CachedMailMessage[]>(this.messagesPath(storageUserId), []),
    ]);
    const nodes = new Map<string, EmailWikiGraph['nodes'][number]>();
    const links: EmailWikiGraph['links'] = [];
    const senderCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();
    const messageKeywords = new Map<string, string[]>();

    accounts.forEach(account => nodes.set(`account:${account.id}`, {
      id: `account:${account.id}`,
      type: 'account',
      label: account.displayName || account.email,
      subtitle: account.email,
      weight: 1,
      accountId: account.id,
    }));

    messages.forEach(message => {
      const sender = firstAddressFromText(message.from) || String(message.from || '未知发件人').trim().toLowerCase();
      senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
      const keywords = extractEmailWikiKeywords(`${message.subject}\n${message.snippet}\n${message.text.slice(0, 2_000)}`);
      messageKeywords.set(message.id, keywords);
      keywords.forEach(keyword => keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1));
    });

    const allowedKeywords = new Set(
      Array.from(keywordCounts.entries())
        .filter(([, count]) => count >= 2)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 180)
        .map(([keyword]) => keyword),
    );

    messages.forEach(message => {
      const messageNodeId = `message:${message.id}`;
      const sender = firstAddressFromText(message.from) || String(message.from || '未知发件人').trim().toLowerCase();
      const senderNodeId = `sender:${sender}`;
      nodes.set(messageNodeId, {
        id: messageNodeId,
        type: 'message',
        label: message.subject || '（无主题）',
        subtitle: `${message.from || '未知发件人'} · ${message.date || ''}`,
        weight: 1,
        unread: !message.seen,
        messageId: message.id,
        accountId: message.accountId,
      });
      if (!nodes.has(senderNodeId)) nodes.set(senderNodeId, {
        id: senderNodeId,
        type: 'sender',
        label: sender || '未知发件人',
        weight: senderCounts.get(sender) || 1,
      });
      if (nodes.has(`account:${message.accountId}`)) {
        links.push({ source: `account:${message.accountId}`, target: messageNodeId, type: 'owns' });
      }
      links.push({ source: senderNodeId, target: messageNodeId, type: 'sent' });
      (messageKeywords.get(message.id) || []).filter(keyword => allowedKeywords.has(keyword)).slice(0, 4).forEach(keyword => {
        const keywordNodeId = `keyword:${keyword}`;
        if (!nodes.has(keywordNodeId)) nodes.set(keywordNodeId, {
          id: keywordNodeId,
          type: 'keyword',
          label: keyword,
          weight: keywordCounts.get(keyword) || 1,
        });
        links.push({ source: keywordNodeId, target: messageNodeId, type: 'keyword' });
      });
    });

    const graph: EmailWikiGraph = {
      generatedAt: new Date().toISOString(),
      counts: {
        accounts: accounts.length,
        senders: senderCounts.size,
        messages: messages.length,
        keywords: allowedKeywords.size,
      },
      nodes: Array.from(nodes.values()),
      links,
    };
    await this.writeJson(this.wikiPath(storageUserId), graph);
    return graph;
  }

  async queryWikiGraph(userId: unknown, options: EmailWikiQueryOptions = {}): Promise<EmailWikiGraph> {
    const graph = await this.buildWikiGraph(userId);
    const query = normalizeSearchText(options.query);
    const limit = Math.max(10, Math.min(240, Number(options.limit || 80) || 80));
    const candidates = graph.nodes
      .filter(node => !options.nodeType || node.type === options.nodeType)
      .filter(node => !query || normalizeSearchText(`${node.label} ${node.subtitle || ''}`).includes(query))
      .sort((left, right) => right.weight - left.weight);
    const seedIds = new Set(candidates.slice(0, Math.max(1, Math.floor(limit / 2))).map(node => node.id));
    const selectedIds = new Set(seedIds);
    for (const link of graph.links) {
      if (selectedIds.size >= limit) break;
      if (seedIds.has(link.source)) selectedIds.add(link.target);
      if (seedIds.has(link.target)) selectedIds.add(link.source);
    }
    const nodes = graph.nodes.filter(node => selectedIds.has(node.id)).slice(0, limit);
    const retainedIds = new Set(nodes.map(node => node.id));
    const links = graph.links.filter(link => retainedIds.has(link.source) && retainedIds.has(link.target));
    return {
      generatedAt: graph.generatedAt,
      counts: graph.counts,
      nodes,
      links,
    };
  }

  async getMessage(userId: unknown, accountId: string, messageId: string): Promise<CachedMailMessage> {
    const storageUserId = await this.resolveMailboxDataUserId(userId);
    const message = (await this.listMessages(storageUserId, accountId, 0, 'all')).find(item => item.id === messageId);
    if (!message) throw new Error('邮件不存在，可能尚未完成同步。');
    const needsBodyTextUpgrade = message.contentLoaded === true
      && message.localOnly !== true
      && Number(message.bodyTextVersion || 0) < MAIL_BODY_TEXT_VERSION;
    if (message.contentLoaded === true) {
      const normalized = await this.normalizeCachedMessageText(storageUserId, message);
      if (needsBodyTextUpgrade) this.upgradeCachedMessageBodyInBackground(storageUserId, normalized);
      return this.decorateMessageAttachments(storageUserId, normalized);
    }
    const loadKey = `${sanitizeUserId(storageUserId)}:${message.id}`;
    const activeLoad = this.messageLoadPromises.get(loadKey);
    if (activeLoad) return this.decorateMessageAttachments(storageUserId, await activeLoad);
    const loadPromise = this.hydrateMessageContent(storageUserId, message);
    this.messageLoadPromises.set(loadKey, loadPromise);
    let hydrated: CachedMailMessage;
    try {
      hydrated = await loadPromise;
    } finally {
      if (this.messageLoadPromises.get(loadKey) === loadPromise) this.messageLoadPromises.delete(loadKey);
    }
    return this.decorateMessageAttachments(storageUserId, hydrated);
  }

  private upgradeCachedMessageBodyInBackground(userId: unknown, message: CachedMailMessage): void {
    const loadKey = `${sanitizeUserId(userId)}:${message.id}`;
    if (this.messageLoadPromises.has(loadKey)) return;
    const loadPromise = this.hydrateMessageContent(userId, message);
    this.messageLoadPromises.set(loadKey, loadPromise);
    void loadPromise
      .then(() => {
        this.emit(userId, {
          type: 'message-body-updated',
          accountId: message.accountId,
          messageId: message.id,
          syncedAt: new Date().toISOString(),
        });
      })
      .catch(error => {
        logger.warn(`[Mailbox] Could not refresh legacy body text; keeping cached body: account=${message.accountId} uid=${message.uid}`, error);
      })
      .finally(() => {
        if (this.messageLoadPromises.get(loadKey) === loadPromise) this.messageLoadPromises.delete(loadKey);
      });
  }

  private async normalizeCachedMessageText(userId: unknown, message: CachedMailMessage): Promise<CachedMailMessage> {
    const text = normalizeMailText(message.text);
    const snippet = text.replace(/\s+/g, ' ').slice(0, 240);
    if (text === message.text && snippet === message.snippet) return message;

    const updated: CachedMailMessage = { ...message, text, snippet };
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    await this.writeJson(this.messagesPath(userId), messages.map(item => item.id === updated.id ? updated : item));
    logger.info(`[Mailbox] Normalized cached message body: account=${message.accountId} uid=${message.uid}`);
    void this.buildWikiGraph(userId).catch(error => {
      logger.warn('[Mailbox] Failed to refresh email Wiki graph after normalizing cached content:', error);
    });
    return updated;
  }

  async resolveAttachmentFile(
    userId: unknown,
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<ResolvedMailAttachment> {
    let message = (await this.listMessages(userId, accountId, 0, 'all')).find(item => item.id === messageId);
    if (!message) throw new Error('邮件不存在，可能尚未完成同步。');
    if (message.contentLoaded !== true) {
      await this.getMessage(userId, accountId, messageId);
      message = (await this.listMessages(userId, accountId, 0, 'all')).find(item => item.id === messageId);
    }
    if (!message) throw new Error('邮件不存在，可能尚未完成同步。');
    if (message.attachmentsLoaded !== true) throw new Error('附件仍在后台准备，请稍后重试。');
    const attachment = (message.attachments || []).find(item => item.id === attachmentId);
    if (!attachment) throw new Error('附件不存在或已从邮件中移除。');
    if (!attachment.available || !attachment.storageKey) {
      throw new Error(attachment.error || '附件尚不可下载。');
    }
    const root = path.resolve(this.attachmentsRoot(userId));
    const filePath = path.resolve(root, attachment.storageKey);
    if (!isPathInside(root, filePath)) throw new Error('附件存储路径无效。');
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error('附件文件不存在，请重新读取邮件。');
    return {
      filePath,
      filename: safeAttachmentFilename(attachment.filename),
      contentType: String(attachment.contentType || 'application/octet-stream'),
      size: stat.size,
    };
  }

  async prepareMessageAttachments(
    userId: unknown,
    accountId: string,
    messageId: string,
  ): Promise<CachedMailMessage> {
    let message = (await this.listMessages(userId, accountId, 0, 'all')).find(item => item.id === messageId);
    if (!message) throw new Error('邮件不存在，可能尚未完成同步。');
    if (message.contentLoaded !== true) {
      await this.getMessage(userId, accountId, messageId);
      message = (await this.listMessages(userId, accountId, 0, 'all')).find(item => item.id === messageId);
    }
    if (!message) throw new Error('邮件不存在，可能尚未完成同步。');
    if (message.attachmentsLoaded === true) return this.decorateMessageAttachments(userId, message);

    const loadKey = `${sanitizeUserId(userId || 'web-user')}:${message.id}`;
    let attachmentLoad = this.attachmentLoadPromises.get(loadKey);
    if (!attachmentLoad) {
      // A renderer or process restart can leave a persisted "preparing" marker
      // without its original background promise. Re-fetch the source in that
      // case so clicking the attachment always repairs and completes the cache.
      await this.hydrateMessageContent(userId, message);
      attachmentLoad = this.attachmentLoadPromises.get(loadKey);
    }
    if (attachmentLoad) await attachmentLoad;

    const completed = (await this.listMessages(userId, accountId, 0, 'all')).find(item => item.id === messageId);
    if (!completed || completed.attachmentsLoaded !== true) {
      throw new Error('附件准备失败，请重新读取邮件后重试。');
    }
    return this.decorateMessageAttachments(userId, completed);
  }

  private decorateMessageAttachments(userId: unknown, message: CachedMailMessage): CachedMailMessage {
    const previewRoot = path.resolve(this.attachmentsRoot(userId));
    const attachments = (message.attachments || []).map(attachment => {
      const { storageKey, ...publicAttachment } = attachment;
      if (!storageKey || !attachment.available) return publicAttachment;
      const previewPath = path.resolve(previewRoot, storageKey);
      if (!isPathInside(previewRoot, previewPath)) {
        return { ...publicAttachment, available: false, error: '附件存储路径无效。' };
      }
      return { ...publicAttachment, previewPath, previewRoot };
    });
    return { ...message, attachments };
  }

  private async persistParsedAttachments(
    userId: unknown,
    messageId: string,
    parsedAttachments: ParsedIncomingAttachment[],
  ): Promise<CachedMailAttachment[]> {
    const messageRoot = this.attachmentMessageRoot(userId, messageId);
    const root = this.attachmentsRoot(userId);
    await fs.rm(messageRoot, { recursive: true, force: true });
    const attachments: CachedMailAttachment[] = [];
    let acceptedBytes = 0;
    for (let index = 0; index < parsedAttachments.length && index < MAX_INCOMING_ATTACHMENTS; index += 1) {
      const source = parsedAttachments[index];
      const content = Buffer.isBuffer(source.content) ? source.content : Buffer.from(source.content || '');
      const size = content.byteLength || Number(source.size || 0);
      const filename = safeAttachmentFilename(source.filename, `attachment-${index + 1}.bin`);
      const contentHash = createHash('sha256').update(content).digest('hex');
      const base: CachedMailAttachment = {
        id: `${contentHash.slice(0, 24)}-${index + 1}`,
        filename,
        contentType: String(source.contentType || 'application/octet-stream').slice(0, 200),
        size,
        contentDisposition: String(source.contentDisposition || '').slice(0, 60) || undefined,
        contentId: String(source.cid || '').slice(0, 500) || undefined,
        related: source.related === true,
        available: false,
      };
      if (size > MAX_INCOMING_ATTACHMENT_BYTES) {
        attachments.push({ ...base, error: '附件超过 25 MB，未保存到本机。' });
        continue;
      }
      if (acceptedBytes + size > MAX_INCOMING_ATTACHMENTS_TOTAL_BYTES) {
        attachments.push({ ...base, error: '该邮件附件总量超过 100 MB，未保存此附件。' });
        continue;
      }
      const storedFilename = `${contentHash.slice(0, 24)}-${filename}`;
      const absolutePath = path.join(messageRoot, storedFilename);
      if (!isPathInside(root, absolutePath)) {
        attachments.push({ ...base, error: '附件文件名无效。' });
        continue;
      }
      await fs.mkdir(messageRoot, { recursive: true });
      await fs.writeFile(absolutePath, content, { mode: 0o600 });
      acceptedBytes += size;
      attachments.push({
        ...base,
        available: true,
        storageKey: path.relative(root, absolutePath),
      });
    }
    return attachments;
  }

  private async hydrateMessageContent(userId: unknown, cached: CachedMailMessage): Promise<CachedMailMessage> {
    const account = await this.findAccount(userId, cached.accountId);
    const folder = normalizeMailFolder(cached.folder);
    if (folder === 'inbox') await this.ensureConnected(userId, account);
    const runtime = this.runtimes.get(this.runtimeKey(userId, account.id));
    if (folder === 'inbox' && (!runtime?.client || runtime.status !== 'connected')) throw new Error('邮箱尚未连接，无法读取邮件正文。');
    const startedAt = Date.now();
    // ImapFlow serializes commands on a connection. A full inbox metadata sync
    // can therefore hold a later FETCH BODY for a long time. Use a short-lived
    // read-only connection for the selected message while the main connection
    // is busy, so opening mail remains interactive without interrupting sync.
    let fetchClient = runtime?.client || this.createClient(account);
    let dedicatedClient: ImapFlow | null = null;
    if (folder !== 'inbox' || runtime?.syncing) {
      dedicatedClient = this.createClient(account);
      fetchClient = dedicatedClient;
      logger.info(`[Mailbox] Using priority body connection: account=${cached.accountId} uid=${cached.uid}`);
    }
    let message;
    try {
      message = await withTimeout((async () => {
        if (dedicatedClient) {
          await dedicatedClient.connect();
          await dedicatedClient.mailboxOpen(cached.mailboxPath || await this.resolveMailboxPath(dedicatedClient, folder), { readOnly: true });
        }
        return fetchClient.fetchOne(String(cached.uid), {
          uid: true,
          source: true,
          flags: true,
          internalDate: true,
        }, { uid: true });
      })(), MESSAGE_BODY_FETCH_TIMEOUT_MS,
        '邮箱服务器读取正文超时，请检查网络或稍后重试。',
        () => {
          logger.warn(`[Mailbox] Message body fetch timed out: account=${cached.accountId} uid=${cached.uid}`);
          try { fetchClient?.close(); } catch { /* connection recovery is handled below */ }
        });
    } finally {
      if (dedicatedClient) {
        try { await dedicatedClient.logout(); } catch { try { dedicatedClient.close(); } catch { /* no-op */ } }
      }
    }
    if (!message || !message.source) throw new Error('邮件正文不存在或已从服务器移除。');
    const parsed = await withTimeout(
      simpleParser(message.source),
      MESSAGE_PARSE_TIMEOUT_MS,
      '邮件格式解析超时，可能包含异常或过大的正文。',
    );
    const text = normalizeParsedMailText(parsed.text, parsed.html);
    const parsedAttachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    const pendingAttachments: CachedMailAttachment[] = parsedAttachments.slice(0, MAX_INCOMING_ATTACHMENTS).map((attachment, index) => ({
      id: `${cached.id}-pending-${index + 1}`,
      filename: safeAttachmentFilename(attachment.filename, `attachment-${index + 1}.bin`),
      contentType: String(attachment.contentType || 'application/octet-stream').slice(0, 200),
      size: Buffer.isBuffer(attachment.content) ? attachment.content.byteLength : Number(attachment.size || 0),
      contentDisposition: String(attachment.contentDisposition || '').slice(0, 60) || undefined,
      contentId: String(attachment.cid || '').slice(0, 500) || undefined,
      related: attachment.related === true,
      available: false,
      error: '附件正在后台准备。',
    }));
    const hydrated: CachedMailMessage = {
      ...cached,
      messageId: String(parsed.messageId || cached.messageId || ''),
      replyToAddress: firstAddress(parsed.replyTo) || firstAddress(parsed.from) || cached.replyToAddress,
      references: normalizedReferences(parsed.references),
      subject: String(parsed.subject || cached.subject || '（无主题）').slice(0, 500),
      from: normalizeAddressList(parsed.from) || cached.from,
      to: normalizeAddressList(parsed.to) || cached.to,
      date: normalizeMailDate(parsed.date, message.internalDate, cached.date),
      text,
      snippet: text.replace(/\s+/g, ' ').slice(0, 240),
      seen: message.flags ? message.flags.has('\\Seen') : cached.seen,
      contentLoaded: true,
      bodyTextVersion: MAIL_BODY_TEXT_VERSION,
      attachmentsLoaded: parsedAttachments.length === 0,
      attachments: pendingAttachments,
    };
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    await this.writeJson(this.messagesPath(userId), messages.map(item => item.id === hydrated.id
      ? { ...hydrated, seen: item.seen || hydrated.seen }
      : item));
    logger.info(`[Mailbox] Message body loaded in ${Date.now() - startedAt} ms: account=${cached.accountId} uid=${cached.uid}`);
    if (parsedAttachments.length) {
      const attachmentLoadKey = `${sanitizeUserId(userId || 'web-user')}:${hydrated.id}`;
      const attachmentLoad = this.persistMessageAttachments(userId, hydrated, parsedAttachments)
        .finally(() => {
          if (this.attachmentLoadPromises.get(attachmentLoadKey) === attachmentLoad) {
            this.attachmentLoadPromises.delete(attachmentLoadKey);
          }
        });
      this.attachmentLoadPromises.set(attachmentLoadKey, attachmentLoad);
      void attachmentLoad.catch(error => {
        logger.warn(`[Mailbox] Failed to prepare attachments for message ${cached.id}:`, error);
      });
    }
    void this.buildWikiGraph(userId).catch(error => {
      logger.warn('[Mailbox] Failed to refresh email Wiki graph after loading message content:', error);
    });
    return hydrated;
  }

  private async persistMessageAttachments(
    userId: unknown,
    hydrated: CachedMailMessage,
    parsedAttachments: ParsedIncomingAttachment[],
  ): Promise<void> {
    let attachments: CachedMailAttachment[];
    try {
      attachments = await this.persistParsedAttachments(userId, hydrated.id, parsedAttachments);
    } catch (error) {
      attachments = (hydrated.attachments || []).map(attachment => ({
        ...attachment,
        available: false,
        error: `附件准备失败：${(error as Error).message}`,
      }));
    }
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const latest = messages.find(item => item.id === hydrated.id) || hydrated;
    const completed: CachedMailMessage = {
      ...latest,
      contentLoaded: true,
      attachmentsLoaded: true,
      attachments,
    };
    await this.writeJson(this.messagesPath(userId), messages.map(item => item.id === completed.id ? completed : item));
    const syncedAt = new Date().toISOString();
    this.emit(userId, { type: 'messages-updated', accountId: completed.accountId, count: 1, syncedAt });
  }

  async markMessageSeen(userId: unknown, accountId: string, messageId: string): Promise<CachedMailMessage> {
    const cached = (await this.listMessages(userId, accountId, 0, 'inbox')).find(item => item.id === messageId);
    if (!cached) throw new Error('邮件不存在，可能尚未完成同步。');
    if (cached.seen) return cached;
    const account = await this.findAccount(userId, accountId);
    await this.ensureConnected(userId, account);
    const runtime = this.runtimes.get(this.runtimeKey(userId, accountId));
    if (!runtime?.client || runtime.status !== 'connected') throw new Error('邮箱尚未连接，无法更新已读状态。');
    await runtime.client.messageFlagsAdd(String(cached.uid), ['\\Seen'], { uid: true });
    const updated = { ...cached, seen: true };
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    await this.writeJson(this.messagesPath(userId), messages.map(item => item.id === updated.id ? updated : item));
    void this.buildWikiGraph(userId).catch(error => {
      logger.warn('[Mailbox] Failed to refresh email Wiki graph after marking message read:', error);
    });
    const syncedAt = new Date().toISOString();
    this.emit(userId, { type: 'messages-updated', accountId, count: 1, syncedAt });
    return updated;
  }

  async markAllMessagesSeen(userId: unknown, accountId?: string): Promise<number> {
    const accounts = (await this.readAccounts(userId)).filter(account => !accountId || account.id === accountId);
    if (accountId && !accounts.length) throw new Error('邮箱账户不存在。');
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const targetIds = new Set<string>();

    for (const account of accounts) {
      const unread = messages.filter(message => message.accountId === account.id
        && normalizeMailFolder(message.folder) === 'inbox' && !message.seen);
      if (!unread.length) continue;
      await this.ensureConnected(userId, account);
      const runtime = this.runtimes.get(this.runtimeKey(userId, account.id));
      if (!runtime?.client || runtime.status !== 'connected') throw new Error(`邮箱 ${account.email} 尚未连接，无法更新已读状态。`);
      for (let offset = 0; offset < unread.length; offset += 250) {
        const batch = unread.slice(offset, offset + 250);
        await runtime.client.messageFlagsAdd(batch.map(message => message.uid).join(','), ['\\Seen'], { uid: true });
        batch.forEach(message => targetIds.add(message.id));
      }
      this.emit(userId, { type: 'messages-updated', accountId: account.id, count: unread.length, syncedAt: new Date().toISOString() });
    }

    if (!targetIds.size) return 0;
    await this.writeJson(this.messagesPath(userId), messages.map(message => targetIds.has(message.id)
      ? { ...message, seen: true }
      : message));
    void this.buildWikiGraph(userId).catch(error => {
      logger.warn('[Mailbox] Failed to refresh email Wiki graph after marking all messages read:', error);
    });
    return targetIds.size;
  }

  private async upsertSentMessage(
    userId: unknown,
    message: CachedMailMessage,
  ): Promise<CachedMailMessage> {
    const messages = await this.readJson<CachedMailMessage[]>(this.messagesPath(userId), []);
    const key = sentMessageCacheKey(message);
    const next = deduplicateSentMessages([
      ...messages.filter(item => item.id !== message.id && sentMessageCacheKey(item) !== key),
      message,
    ]);
    await this.writeJson(this.messagesPath(userId), next);
    const saved = next.find(item => sentMessageCacheKey(item) === key) || message;
    this.emit(userId, {
      type: 'messages-updated',
      accountId: message.accountId,
      count: 1,
      syncedAt: new Date().toISOString(),
    });
    return saved;
  }

  private async archiveOutgoingMessage(
    account: StoredMailAccount,
    rawMessage: Buffer,
    messageId: string,
    sentAt: Date,
  ): Promise<{ mailboxPath: string; uid?: number }> {
    const client = this.createClient(account);
    try {
      await client.connect();
      const mailboxPath = await this.resolveMailboxPath(client, 'sent');
      await client.mailboxOpen(mailboxPath);

      // Some providers automatically save SMTP submissions. Check first so
      // an IMAP APPEND does not create a second visible copy.
      const existing = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      const existingUids = Array.isArray(existing)
        ? existing.filter(uid => Number.isInteger(uid) && uid > 0)
        : [];
      if (existingUids.length) {
        return { mailboxPath, uid: existingUids[existingUids.length - 1] };
      }

      const appended = await client.append(mailboxPath, rawMessage, ['\\Seen'], sentAt);
      if (!appended) throw new Error('邮箱服务器没有确认 Sent 归档。');
      return { mailboxPath, uid: appended.uid };
    } finally {
      try { await client.logout(); } catch { try { client.close(); } catch { /* no-op */ } }
    }
  }

  async sendReply(userId: unknown, input: {
    accountId: string;
    messageId?: string;
    to: string;
    subject: string;
    body: string;
    attachments?: Array<{
      filename: string;
      contentType?: string;
      content: Buffer;
    }>;
  }): Promise<SendReplyResult> {
    const account = await this.findAccount(userId, String(input.accountId || ''));
    const sourceMessageId = String(input.messageId || '').trim();
    const original = sourceMessageId
      ? await this.getMessage(userId, account.id, sourceMessageId)
      : undefined;
    const to = validateSingleAddress(input.to);
    if (original) {
      const expectedRecipient = validateSingleAddress(original.replyToAddress || firstAddressFromText(original.from));
      if (to !== expectedRecipient) {
        throw new Error('收件人与当前邮件的回复地址不一致，请重新选择邮件后再发送。');
      }
    }
    const subject = String(input.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    const body = String(input.body || '').replace(/\r\n/g, '\n').trim().slice(0, 100_000);
    if (!subject) throw new Error('邮件主题不能为空。');
    if (!body) throw new Error('邮件正文不能为空。');
    const requestedAttachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (requestedAttachments.length > MAX_OUTGOING_ATTACHMENTS) {
      throw new Error('一次最多发送 20 个附件。');
    }
    let outgoingAttachmentBytes = 0;
    const attachments = requestedAttachments.map((attachment, index) => {
      const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content || '');
      if (content.byteLength > MAX_OUTGOING_ATTACHMENT_BYTES) {
        throw new Error(`附件 ${index + 1} 超过 25 MB。`);
      }
      outgoingAttachmentBytes += content.byteLength;
      if (outgoingAttachmentBytes > MAX_OUTGOING_ATTACHMENTS_TOTAL_BYTES) {
        throw new Error('附件总大小不能超过 50 MB。');
      }
      return {
        filename: safeAttachmentFilename(attachment.filename, `attachment-${index + 1}.bin`),
        contentType: String(attachment.contentType || 'application/octet-stream').slice(0, 200),
        content,
      };
    });

    const preset = providerPreset(account.provider);
    const smtpHost = String(account.smtpHost || preset?.smtpHost || '').trim();
    const smtpPort = Number(account.smtpPort || preset?.smtpPort || 0);
    const smtpSecure = account.smtpSecure ?? preset?.smtpSecure ?? true;
    if (!smtpHost || !smtpPort) throw new Error('该邮箱尚未配置 SMTP 发送服务器。');

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      auth: { user: account.email, pass: decrypt(account.encryptedCredential) },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    const references = original ? [...normalizedReferences(original.references), original.messageId]
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(-100) : [];
    const sentAt = new Date();
    const generatedMessageId = `<${randomUUID()}@scholar-harness.local>`;
    const mailOptions: nodemailer.SendMailOptions = {
      from: { name: account.displayName, address: account.email },
      to,
      subject,
      text: body,
      date: sentAt,
      messageId: generatedMessageId,
      inReplyTo: original?.messageId || undefined,
      references: references.length ? references : undefined,
      attachments: attachments.length ? attachments : undefined,
    };
    // Send and archive the exact same RFC822 message. Supplying a stable
    // Message-ID also lets a later IMAP sync reconcile records without copies.
    const rawMessage = await new MailComposer(mailOptions).compile().build();
    const result = await transporter.sendMail({
      envelope: { from: account.email, to: [to] },
      raw: rawMessage,
    });
    const deliveredMessageId = String(result.messageId || generatedMessageId);
    logger.info(`[Mailbox] ${original ? 'Reply' : 'Message'} sent | account=${account.id} | original=${original?.id || 'none'} | result=${deliveredMessageId}`);

    let recordedLocally = false;
    let archivedToServer = false;
    let archiveWarning: string | undefined;
    let sentMessage: CachedMailMessage | undefined;
    const localId = `${account.id}:sent:local:${createHash('sha256').update(deliveredMessageId).digest('hex').slice(0, 24)}`;
    try {
      const cachedAttachments = attachments.length
        ? await this.persistParsedAttachments(userId, localId, attachments.map(attachment => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          content: attachment.content,
          size: attachment.content.byteLength,
        })))
        : [];
      sentMessage = await this.upsertSentMessage(userId, {
        id: localId,
        accountId: account.id,
        uid: 0,
        messageId: deliveredMessageId,
        replyToAddress: to,
        references,
        subject,
        from: account.displayName ? `${account.displayName} <${account.email}>` : account.email,
        to,
        date: sentAt.toISOString(),
        text: body,
        snippet: body.replace(/\s+/g, ' ').slice(0, 280),
        seen: true,
        folder: 'sent',
        contentLoaded: true,
        bodyTextVersion: MAIL_BODY_TEXT_VERSION,
        attachmentsLoaded: true,
        attachments: cachedAttachments,
        localOnly: true,
        archiveStatus: 'pending',
      });
      recordedLocally = true;
    } catch (error) {
      archiveWarning = `邮件已发出，但本地“已发送”记录保存失败：${(error as Error).message}`;
      logger.error('[Mailbox] Failed to persist a delivered outgoing message:', error);
    }

    try {
      const archived = await this.archiveOutgoingMessage(account, rawMessage, deliveredMessageId, sentAt);
      archivedToServer = true;
      if (sentMessage) {
        sentMessage = await this.upsertSentMessage(userId, {
          ...sentMessage,
          id: archived.uid ? `${account.id}:sent:${archived.uid}` : sentMessage.id,
          uid: archived.uid || 0,
          mailboxPath: archived.mailboxPath,
          localOnly: !archived.uid,
          archiveStatus: 'archived',
        });
      }
    } catch (error) {
      const reason = String((error as Error).message || '未知错误');
      archiveWarning = archiveWarning
        ? `${archiveWarning}；服务器 Sent 归档失败：${reason}`
        : `邮件已发出并保存在本机，但服务器 Sent 归档失败：${reason}`;
      logger.warn(`[Mailbox] SMTP accepted message but Sent archive failed | account=${account.id}: ${reason}`);
      if (sentMessage) {
        sentMessage = await this.upsertSentMessage(userId, {
          ...sentMessage,
          localOnly: true,
          archiveStatus: 'failed',
        }).catch(() => sentMessage);
      }
    }

    void this.rebuildWikiGraphAfterSync(userId);
    return {
      messageId: deliveredMessageId,
      accepted: (result.accepted || []).map(item => String(item)),
      rejected: (result.rejected || []).map(item => String(item)),
      recordedLocally,
      archivedToServer,
      archiveWarning,
      sentMessage,
    };
  }
}

function firstAddressFromText(value: string): string {
  const bracket = String(value || '').match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = String(value || '').match(/[^\s<>,;]+@[^\s<>,;]+/);
  return String(bracket?.[1] || plain?.[0] || '').trim().toLowerCase();
}
