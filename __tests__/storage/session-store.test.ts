import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DraftConflictError,
  SessionStore,
  sanitizeDraftChapterName,
} from "../../src/storage/session-store";
import { sanitizeUserId } from "../../src/utils/paths";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("SessionStore draft storage", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  it("stores draft files under the sanitized user and chapter path", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-"));
    const dataDir = path.join(tempRoot, "sessions");
    const store = new SessionStore(dataDir);

    await store.saveDraft("../unsafe-user", "../escape", "draft content");

    const unsafeEscapedPath = path.join(tempRoot, "unsafe-user", "escape.txt");
    await expect(exists(unsafeEscapedPath)).resolves.toBe(false);

    const safeUserId = sanitizeUserId("../unsafe-user");
    const safeChapter = sanitizeDraftChapterName("../escape");
    const safeDraftPath = path.join(dataDir, safeUserId, "drafts", `${safeChapter}.txt`);
    await expect(exists(safeDraftPath)).resolves.toBe(true);

    const loaded = await store.loadDraft("../unsafe-user", "../escape");
    expect(loaded?.content).toBe("draft content");

    const drafts = await store.listDrafts("../unsafe-user");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].chapterName).toBe(safeChapter);
    expect(drafts[0].fileName).toBe(`${safeChapter}.txt`);
    expect(drafts[0].storageFormat).toBe("txt");
  });

  it("reads a legacy JSON draft and replaces it with the canonical TXT on save", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-"));
    const dataDir = path.join(tempRoot, "sessions");
    const store = new SessionStore(dataDir);
    const draftsDir = path.join(dataDir, "legacy-user", "drafts");
    await fs.mkdir(draftsDir, { recursive: true });
    const legacyPath = path.join(draftsDir, "results.json");
    await fs.writeFile(legacyPath, JSON.stringify({
      chapterName: "results",
      content: "legacy results",
      savedAt: "2026-07-01T00:00:00.000Z",
    }), "utf-8");

    const legacy = await store.loadDraft("legacy-user", "results");
    expect(legacy).toMatchObject({
      content: "legacy results",
      fileName: "results.json",
      storageFormat: "json",
    });

    await store.saveDraft("legacy-user", "results", "current results");

    await expect(exists(legacyPath)).resolves.toBe(false);
    await expect(exists(path.join(draftsDir, "results.txt"))).resolves.toBe(true);
    await expect(store.loadDraft("legacy-user", "results")).resolves.toMatchObject({
      content: "current results",
      fileName: "results.txt",
      storageFormat: "txt",
    });
  });

  it("treats TXT as the only active source when a stale JSON copy is also present", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-"));
    const dataDir = path.join(tempRoot, "sessions");
    const store = new SessionStore(dataDir);
    const draftsDir = path.join(dataDir, "mixed-user", "drafts");
    await fs.mkdir(draftsDir, { recursive: true });
    await fs.writeFile(path.join(draftsDir, "results.txt"), "current TXT", "utf-8");
    await fs.writeFile(path.join(draftsDir, "results.json"), JSON.stringify({
      chapterName: "results",
      content: "stale JSON",
      savedAt: "2026-07-01T00:00:00.000Z",
    }), "utf-8");

    await expect(store.loadDraft("mixed-user", "results")).resolves.toMatchObject({
      content: "current TXT",
      storageFormat: "txt",
    });
    await expect(store.listDrafts("mixed-user")).resolves.toEqual([
      expect.objectContaining({
        chapterName: "results",
        storageFormat: "txt",
        hasLegacyJson: true,
      }),
    ]);

    await store.saveDraft("mixed-user", "results", "new TXT");
    await expect(exists(path.join(draftsDir, "results.json"))).resolves.toBe(false);
  });

  it("keeps readable non-ASCII chapter names while removing unsafe path characters", () => {
    expect(sanitizeDraftChapterName("摘要")).toBe("摘要");
    expect(sanitizeDraftChapterName("../摘要")).toBe("_摘要");
    expect(sanitizeDraftChapterName("con")).toBe("con_");
  });

  it("serializes concurrent read-modify-write updates for the same chapter", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-"));
    const store = new SessionStore(path.join(tempRoot, "sessions"));
    await store.saveDraft("user", "results", "base");

    await Promise.all([
      store.updateDraft("user", "results", async current => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return `${current?.content || ""}\nA`;
      }),
      store.updateDraft("user", "results", current => `${current?.content || ""}\nB`),
    ]);

    await expect(store.loadDraft("user", "results")).resolves.toMatchObject({
      content: "base\nA\nB",
    });
  });

  it("rejects an update based on a stale savedAt revision", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-"));
    const store = new SessionStore(path.join(tempRoot, "sessions"));
    await store.saveDraft("user", "discussion", "version one");
    const first = await store.loadDraft("user", "discussion");
    await new Promise(resolve => setTimeout(resolve, 10));
    await store.updateDraft("user", "discussion", () => "version two");

    await expect(store.updateDraft(
      "user",
      "discussion",
      () => "stale overwrite",
      { expectedSavedAt: first?.savedAt }
    )).rejects.toBeInstanceOf(DraftConflictError);
    await expect(store.loadDraft("user", "discussion")).resolves.toMatchObject({
      content: "version two",
    });
  });
});
