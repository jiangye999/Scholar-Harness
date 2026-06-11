# Reference Relevance & Evidence Constraint Skill

中文名：参考文献相关性与证据约束 Skill

## Purpose
Ensure that every reference used in manuscript writing directly or appropriately supports the claim it is attached to. This skill prevents irrelevant references, adjacent evidence, mechanistic analogies, background papers, tool traces, and incomplete metadata from being treated as direct evidence.

## When to Use
Use this skill before writing, during one-click paper generation, during Discussion writing, and during final citation/claim audit.

## Core Principles
1. Do not fabricate references, DOI, authors, years, journals, or source metadata.
2. Do not use unrelated or weakly related references as direct support.
3. Every reference must correspond to a specific claim, mechanism, definition, or background statement.
4. Remove references with missing author/year/source, garbled metadata, file-name residue, non-academic sources, unclear PDF provenance, or tool-output traces.
5. Separate reference types and obey their use boundaries.
6. If information is missing, mark `NR`, `需要作者补充`, or `证据不足，不能用于结论`.

## Evidence Types and Use Rules

### Direct evidence
The paper matches the claim in object/system, variable/intervention, method, and result. It can directly support the claim.

### System-specific evidence
The paper is relevant only under a named subsystem, subgroup, region, method, or condition. It can support conditional conclusions only when the boundary is stated.

### Adjacent evidence
The paper is partly related. It may support comparison, hypothesis generation, or bounded explanation, but cannot support a direct conclusion.

### Mechanistic evidence
The paper supports a pathway or process. It may support possible mechanism language, but cannot alone prove the main conclusion.

### Background evidence
The paper supports only background, definitions, concepts, or trends. It cannot support core findings or conclusions.

### Excluded evidence
The paper is unrelated, non-academic, unverifiable, incomplete, garbled, cross-domain without a defensible bridge, or contains tool/file residue. It must not appear in正文 citations.

## Required Audit Tables

### Table 1. Reference Relevance Matrix
| 文献 | 对象/系统 | 变量/干预 | 核心结论对应 | 文献类型 | 证据强度 | 使用边界 | 备注 |
|---|---|---|---|---|---|---|---|

### Table 2. Excluded References
| 文献 | 排除原因 | 备注 |
|---|---|---|

## Workflow
1. For every reference, check the exact claim or mechanism it is meant to support.
2. Check whether the reference is cross-domain, non-academic, incomplete, or metadata-risky.
3. Classify it as Direct, System-specific, Adjacent, Mechanistic, Background, or Excluded.
4. Mark evidence strength and use boundary.
5. Keep Direct/System-specific references for claims, with boundaries where needed.
6. Use Adjacent/Mechanistic references only for cautious explanation, comparison, or hypothesis language.
7. Use Background references only for background or definitions.
8. Remove Excluded references from正文 citations.
9. In audit/planning output, produce Reference Relevance Matrix and Excluded References when requested or when citation risk is high.

## Integration Rules
- In one-click paper writing, apply this skill during outline planning, sentence-level evidence selection, sentence writing, section review, and final audit.
- In Discussion writing, apply this skill before literature comparison and mechanism explanation.
- In Auto Research, include this skill in evidence-chain checks, Reference Cleaning Notes, Reference Relevance Matrix, and Excluded References.
- PDF Wiki sentence-level evidence must remain traceable with `来源Wiki论点库: 句子证XXXXXXX（需核查）` when direct support is uncertain.
- Embedding literature evidence uses normal in-text citation style, such as `(Zhang et al., 2026)`, and must not be labeled as Wiki sentence evidence.
