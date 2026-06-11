import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore, sanitizeDraftChapterName } from "../../src/storage/session-store";
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

    const unsafeEscapedPath = path.join(tempRoot, "unsafe-user", "escape.json");
    await expect(exists(unsafeEscapedPath)).resolves.toBe(false);

    const safeUserId = sanitizeUserId("../unsafe-user");
    const safeChapter = sanitizeDraftChapterName("../escape");
    const safeDraftPath = path.join(dataDir, safeUserId, "drafts", `${safeChapter}.json`);
    await expect(exists(safeDraftPath)).resolves.toBe(true);

    const loaded = await store.loadDraft("../unsafe-user", "../escape");
    expect(loaded?.content).toBe("draft content");

    const drafts = await store.listDrafts("../unsafe-user");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].chapterName).toBe(safeChapter);
  });

  it("keeps readable non-ASCII chapter names while removing unsafe path characters", () => {
    expect(sanitizeDraftChapterName("摘要")).toBe("摘要");
    expect(sanitizeDraftChapterName("../摘要")).toBe("_摘要");
    expect(sanitizeDraftChapterName("con")).toBe("con_");
  });
});
