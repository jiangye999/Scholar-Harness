export const REFERENCE_RELEVANCE_WRITING_RULES = `## Reference Relevance & Evidence Constraint / 参考文献相关性与证据约束

Core rule: every cited reference must support the exact claim being written. Do not use irrelevant, weakly adjacent, non-academic, incomplete, file-name-like, garbled, or tool-trace sources as formal references.

Evidence classes and usage:
1. Direct evidence: object/system, variable/intervention, method, and result match the claim. It may directly support the sentence.
2. System-specific evidence: relevant only under a specific subsystem, subgroup, region, method, or condition. Use only for conditional claims with the boundary stated.
3. Adjacent evidence: partially related. Use only for context, comparison, hypothesis, or limited explanation; never as direct proof.
4. Mechanistic evidence: supports a pathway/process. Use for possible mechanism language; do not infer the main conclusion from it alone.
5. Background evidence: supports concepts, context, or trend statements only; never supports the paper's core conclusion.
6. Excluded evidence: unrelated, non-academic, unverifiable, missing author/year/source, metadata-garbled, tool-output residue, or cross-domain evidence that cannot support this paper. Do not cite it in正文.

Writing constraints:
- Before using a citation, internally classify it as Direct, System-specific, Adjacent, Mechanistic, Background, or Excluded.
- If no Direct or System-specific evidence exists for a strong claim, downgrade the wording, narrow the boundary, or remove the claim.
- Adjacent/Mechanistic/Background references must be signaled through cautious language and boundary wording; they cannot be written as direct support.
- If author, year, source, DOI/URL, or abstract/source text is missing, mark NR or 需要作者补充; do not fabricate metadata.
- PDF Wiki sentence-level evidence must remain traceable with 来源Wiki论点库: 句子证XXXXXXX（需核查） when direct support is uncertain.
- Embedding literature evidence uses only normal in-text citation style, such as (Zhang et al., 2026), without Wiki sentence markers.
- Remove or rewrite any citation whose title/abstract/evidence excerpt does not match the sentence claim.`;

export const REFERENCE_RELEVANCE_RESEARCH_ARTIFACTS = `## Required Reference Relevance Research Artifacts

When doing research planning, Auto Research, citation audit, or quality review, build these artifacts internally and output them when the task asks for audit/planning tables:

Table 1. Reference Relevance Matrix
| Reference | Object/System | Variable/Intervention | Matched Core Claim | Evidence Type | Evidence Strength | Use Boundary | Notes |
|---|---|---|---|---|---|---|---|

Table 2. Excluded References
| Reference | Exclusion Reason | Notes |
|---|---|---|

Required checks:
1. Check every reference against the exact claim/mechanism it is supposed to support.
2. Classify each reference as Direct, System-specific, Adjacent, Mechanistic, Background, or Excluded.
3. Mark NR for missing metadata or missing source support.
4. Remove Excluded references from正文引用 and keep them only in audit notes or appendix when needed.
5. For Adjacent and Mechanistic evidence, explicitly state "only for mechanism explanation / conditional interpretation" in audit output.`;

export const REFERENCE_RELEVANCE_AUDIT_RULES = `${REFERENCE_RELEVANCE_WRITING_RULES}

Audit output requirements:
- Include citation-claim mismatches where a real reference is used for the wrong claim.
- Include weakly related references, metadata-incomplete references, tool-trace references, and references that only support background.
- Recommended actions must be one of: keep as direct support, downgrade wording, mark as mechanism/background only, replace citation, remove citation, remove sentence, or request author/source verification.
- When enough information is available, include Reference Relevance Matrix and Excluded References table in the audit/planning report.`;
