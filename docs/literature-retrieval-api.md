# ScholarClaw Literature Retrieval API 使用指南

## 概述

学术文献检索与引用生成系统已经集成到 ScholarClaw 中。该系统支持：

- **文献导入**: Web of Science 和知网(txt) 导出文件
- **混合检索**: BM25 + Vector + Metadata Filter + Reranker
- **智能写作**: 基于检索结果生成学术段落，自动添加引用
- **引文管理**: 支持数字编号制和作者年份制
- **参考文献格式化**: 支持 GB/T 7714 和 APA 格式

## API 端点

所有 API 端点前缀: `/api/literature-retrieval`

### 1. 导入文献

```http
POST /api/literature-retrieval/import
Content-Type: multipart/form-data

file: <文献导出文件.txt>
source: "wos" | "cnki"
```

**响应:**
```json
{
  "success": true,
  "count": 150,
  "sample": [
    {
      "title": "Climate change impacts on agriculture",
      "authors": ["Smith, J", "Li, W"],
      "year": 2023
    }
  ]
}
```

### 2. 检索文献

```http
POST /api/literature-retrieval/search
Content-Type: application/json

{
  "query": "climate change adaptation strategies",
  "filters": {
    "yearFrom": 2020,
    "yearTo": 2024,
    "authors": ["Smith"],
    "journals": ["Nature Climate Change"]
  },
  "topK": 20,
  "mode": "hybrid"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "query": "climate change adaptation strategies",
    "totalCount": 20,
    "results": [
      {
        "id": "Smith_2023_Climate_change",
        "title": "Climate change adaptation in agriculture",
        "authors": [{"name": "Smith, John", "lastName": "Smith"}],
        "year": 2023,
        "abstract": "...",
        "bm25Score": 0.85,
        "vectorScore": 0.92,
        "combinedScore": 0.88,
        "rank": 1
      }
    ],
    "timing": {
      "bm25Ms": 15,
      "vectorMs": 45,
      "rerankMs": 0,
      "totalMs": 62
    }
  }
}
```

### 3. 智能写作

```http
POST /api/literature-retrieval/write
Content-Type: application/json

{
  "topic": "climate change impacts on agricultural systems",
  "expectedParagraphs": 3,
  "citationStyle": "numeric",
  "referenceStyle": "gbt7714",
  "maxCitationsPerParagraph": 3
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "generatedText": "Climate change poses significant challenges to agricultural systems worldwide[1,2]. Recent studies have shown that temperature increases and changing precipitation patterns affect crop yields[3]. Adaptation strategies are essential for food security[4-6].",
    "paragraphs": [
      {
        "paragraphId": "para-0",
        "content": "Climate change poses significant challenges to agricultural systems worldwide[1,2].",
        "evidenceIds": ["lit_001", "lit_002"],
        "generated": true
      }
    ],
    "references": [
      {
        "id": "lit_001",
        "numericId": 1,
        "citationKey": "Smith2023Climate",
        "formatted": "Smith J, Li W. Climate change adaptation[J]. Nature Climate Change, 2023, 15(3): 100-110. DOI: 10.xxx/xxx",
        "style": "gbt7714"
      }
    ],
    "statistics": {
      "totalParagraphs": 3,
      "totalCitations": 6,
      "uniqueReferences": 5
    }
  }
}
```

### 4. 获取统计信息

```http
GET /api/literature-retrieval/stats
```

**响应:**
```json
{
  "success": true,
  "data": {
    "totalCount": 150,
    "yearRange": { "min": 2015, "max": 2024 },
    "topJournals": [
      { "name": "Nature Climate Change", "count": 25 },
      { "name": "Global Environmental Change", "count": 18 }
    ],
    "topAuthors": [
      { "name": "Smith, J", "count": 8 },
      { "name": "Li, W", "count": 6 }
    ],
    "totalIndexed": 150
  }
}
```

### 5. 清空索引

```http
DELETE /api/literature-retrieval/clear
```

**响应:**
```json
{
  "success": true,
  "message": "Literature index cleared"
}
```

## 使用流程示例

### 完整工作流程

```bash
# 1. 导入 WoS 文献
 curl -X POST http://localhost:18789/api/literature-retrieval/import \
  -F "file=@wos_export.txt" \
  -F "source=wos"

# 2. 检索相关文献
 curl -X POST http://localhost:18789/api/literature-retrieval/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "climate change adaptation",
    "filters": {"yearFrom": 2020, "yearTo": 2024},
    "topK": 10
  }'

# 3. 生成学术段落
 curl -X POST http://localhost:18789/api/literature-retrieval/write \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "climate change impacts on agriculture",
    "expectedParagraphs": 2,
    "citationStyle": "numeric",
    "referenceStyle": "gbt7714"
  }'
```

## 配置说明

在 `configs/literature-retrieval.json` 中可以配置：

- **BM25参数**: k1, b, 字段权重
- **向量检索**: embedding模型、维度、相似度算法
- **生成参数**: 每段最大引用数、默认引文风格
- **日志设置**: 启用/禁用、保留天数

## 注意事项

1. **文献导入**: 支持的文件格式为 .txt (WoS/知网导出)
2. **索引持久化**: 当前为内存索引，重启后需要重新导入
3. **向量检索**: 默认使用简单hash-based embedding，如需使用OpenAI embedding请配置 API_URL 和 API_KEY
4. **引文编号**: 数字编号制自动压缩连续编号（[1,2,3] → [1-3]）
