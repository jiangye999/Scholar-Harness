import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEmbeddingLibraryRouter } from "../../src/server/routes/embedding-library";
import {
  manualMergeKeywords,
  sanitizeOuterTagsConfig,
  type LiteratureRecord,
  type OuterTagsConfig,
} from "../../src/literature/keyword-library";

function createRecords(count: number): LiteratureRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `paper-${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      title: `Paper ${index + 1}`,
      author: `Author ${index + 1}`,
      authors: [{ name: `Author ${index + 1}` }],
      year: 2020 + (index % 5),
      journal: "Journal of Tests",
      doi: index === 0 ? "10.1000/test-doi" : undefined,
      abstract: `Abstract for ${id}`,
      keywords: index === 0 ? ["nitrogen", "maize"] : [`keyword-${index + 1}`],
      aiKeywords: index === 1 ? ["nitrogen"] : [],
      documentType: "Article",
      embedding: index === 0 ? [0.1, 0.2, 0.3] : undefined,
    };
  });
}

function createTestApp(records: LiteratureRecord[], initialConfig?: OuterTagsConfig) {
  const configs = new Map<string, OuterTagsConfig>();
  if (initialConfig) {
    configs.set("web-user", initialConfig);
  }

  const app = express();
  app.use(express.json());
  app.use("/api/embedding-library", createEmbeddingLibraryRouter({
    readUserLiteratureRecords: () => records,
    loadOuterTagsConfigForUser: userId => configs.get(userId) || { mergedTags: [], promotedTags: [] },
    saveOuterTagsConfigForUser: (userId, config) => {
      const sanitized = sanitizeOuterTagsConfig(config);
      configs.set(userId, sanitized);
      return sanitized;
    },
    refreshOuterTagCounts: (papers, config) => {
      const refreshed = sanitizeOuterTagsConfig(config);
      for (const tag of refreshed.mergedTags) {
        const result = manualMergeKeywords(papers, tag.originalKeywords, tag.name);
        tag.count = result.count;
        tag.literatureIds = result.literatureIds;
      }
      return refreshed;
    },
  }));

  return app;
}

describe("embedding-library routes", () => {
  it("returns the first 100 papers by default and exposes hasMore", async () => {
    const app = createTestApp(createRecords(105));

    const response = await request(app).get("/api/embedding-library").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.papers).toHaveLength(100);
    expect(response.body.paperPage.total).toBe(105);
    expect(response.body.paperPage.hasMore).toBe(true);
  });

  it("paginates keyword tags with a search query", async () => {
    const app = createTestApp(createRecords(105));

    const response = await request(app)
      .get("/api/embedding-library/tags")
      .query({ query: "keyword-", limit: 10 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.tags).toHaveLength(10);
    expect(response.body.totalKeywords).toBe(104);
    expect(response.body.hasMore).toBe(true);
  });

  it("returns complete literature detail data for the detail window", async () => {
    const app = createTestApp(createRecords(3));

    const response = await request(app)
      .get("/api/embedding-library/literature/paper-001")
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.literature.title).toBe("Paper 1");
    expect(response.body.literature.doi).toBe("10.1000/test-doi");
    expect(response.body.literature.abstract).toContain("paper-001");
    expect(response.body.literature.allKeywords).toEqual(["nitrogen", "maize"]);
    expect(response.body.literature.embeddingDimension).toBe(3);
    expect(response.body.literature.preview.hasEmbedding).toBe(true);
  });

  it("uses merged outer tags when filtering literature", async () => {
    const app = createTestApp(createRecords(3), {
      promotedTags: [],
      mergedTags: [
        {
          name: "nitrogen-system",
          originalKeywords: ["nitrogen", "maize"],
          count: 0,
          literatureIds: [],
        },
      ],
    });

    const response = await request(app)
      .post("/api/embedding-library/filter")
      .send({ options: { keywords: ["nitrogen-system"], mode: "AND" } })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.total).toBe(2);
    expect(response.body.papers.map((paper: { id: string }) => paper.id)).toEqual(["paper-001", "paper-002"]);
  });

  it("builds a bounded Obsidian graph from the active literature filter", async () => {
    const app = createTestApp(createRecords(105));

    const response = await request(app)
      .post("/api/embedding-library/graph")
      .send({
        options: { keywords: ["nitrogen"], mode: "OR" },
        keywordLimit: 20,
        paperLimit: 40,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.total).toBe(2);
    expect(response.body.graph.paperCount).toBe(2);
    expect(response.body.graph.keywordCount).toBeGreaterThan(0);
    expect(response.body.graph.nodes.some((node: { type: string; label: string }) =>
      node.type === "keyword" && node.label === "nitrogen"
    )).toBe(true);
    expect(response.body.graph.edges.every((edge: { source: string; target: string }) =>
      edge.source.startsWith("keyword:") && edge.target.startsWith("paper:")
    )).toBe(true);
  });

  it("uses every matching literature record when aggregating the graph", async () => {
    const app = createTestApp(createRecords(105));

    const response = await request(app)
      .post("/api/embedding-library/graph")
      .send({ keywordLimit: 20, paperLimit: 40 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.total).toBe(105);
    expect(response.body.sampled).toBe(105);
    expect(response.body.truncated).toBe(false);
    expect(response.body.graph.paperCount).toBe(105);
  });

  it("omits untagged papers and never renders a shared untagged keyword node", async () => {
    const records = createRecords(2);
    records[1].keywords = [];
    records[1].aiKeywords = [];
    const app = createTestApp(records);

    const response = await request(app)
      .post("/api/embedding-library/graph")
      .send({})
      .expect(200);

    expect(response.body.graph.paperCount).toBe(1);
    expect(response.body.graph.nodes.some((node: { label: string }) =>
      node.label === "未标注关键词"
    )).toBe(false);
    expect(response.body.graph.nodes.some((node: { id: string }) =>
      node.id === "paper:paper-002"
    )).toBe(false);
    expect(response.body.graph.edges.some((edge: { target: string }) =>
      edge.target === "paper:paper-002"
    )).toBe(false);
  });

  it("uses quick-filter merged tags as graph nodes and connects their papers", async () => {
    const app = createTestApp(createRecords(3), {
      promotedTags: [],
      mergedTags: [{
        name: "nitrogen-system",
        originalKeywords: ["nitrogen", "maize"],
        count: 2,
        literatureIds: ["paper-001", "paper-002"],
      }],
    });

    const response = await request(app)
      .post("/api/embedding-library/graph")
      .send({})
      .expect(200);

    const mergedNode = response.body.graph.nodes.find((node: { type: string; label: string }) =>
      node.type === "keyword" && node.label === "nitrogen-system"
    );
    expect(mergedNode).toBeTruthy();
    expect(response.body.graph.nodes.some((node: { type: string; label: string }) =>
      node.type === "keyword" && ["nitrogen", "maize"].includes(node.label)
    )).toBe(false);
    expect(response.body.graph.edges.filter((edge: { source: string }) =>
      edge.source === mergedNode.id
    )).toHaveLength(2);
  });
});
