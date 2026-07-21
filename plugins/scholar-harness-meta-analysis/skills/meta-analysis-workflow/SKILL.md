---
name: meta-analysis-workflow
description: Run the complete Scholar Harness Meta-analysis workflow, including source ingestion, PDF data extraction, coding-table review, figure digitization import, effect-size configuration, user confirmation, statistical analysis, R plotting, export, and writing-context synchronization. Use whenever the user asks to conduct, continue, inspect, repair, plot, export, or write from a Meta-analysis in Scholar Harness.
---

# Scholar Harness Meta-analysis Workflow

Use the `scholarHarnessMetaAnalysis` MCP tools. Scholar Harness is the source of truth; do not create
an unrelated spreadsheet or analysis database when the local service is available.

## Workflow

1. Call `meta_health` before doing any work. If unavailable, tell the user to start Scholar Harness.
2. Call `meta_list_sources` and identify the exact PDF IDs. Do not guess IDs from titles.
3. When new PDFs are supplied, call `meta_upload_pdfs`, then poll `meta_list_sources`. If existing PDFs
   lack Meta data, call `meta_extract_sources` and poll until extraction is complete or an error appears.
4. Review coding tables with `meta_get_source`. Use `meta_add_coding_column`,
   `meta_save_coding_table`, `meta_delete_coding_selection`, or `meta_import_digitized_data` only when
   the requested change is explicit and the target PDF/table is known.
5. Call `meta_inspect_dataset` before selecting a model. Report missingness, candidate outcomes,
   possible moderators, and warnings.
6. Call `meta_plan_analysis` with the user's scientific objective. The plan must identify:
   - separate treatment/control contrast rules for scientifically different questions (for example
     fertilizer addition versus zero N, N reduction versus conventional N, and inhibitor versus the
     same N rate without inhibitor);
   - effect measure for each outcome;
   - mean, SD/SE, and sample-size mappings;
   - study ID and clustering column;
   - moderators, subgroup variables, and preprocessing;
   - whether `needs_manual_review=true` rows are excluded from the primary analysis;
   - exclusions and unresolved ambiguities.
7. Do not run the analysis while treatment/control mapping, units, duplicated measurements, or outcome
   direction remain ambiguous. Ask the user a concise confirmation question and preserve the proposed
   config.
8. After explicit confirmation, call `meta_run_analysis` with the confirmed config. Set `renderPlots`
   to true unless the user asks for calculations only. R rendering uses the globally configured Scholar
   Harness R plugin and records generated artifacts in the same Meta writing context.
9. Call `meta_get_results` with the returned `analysisId` (or the owning `conversationId`) after
   completion. Validate study/effect counts, skipped rows, heterogeneity, subgroup sufficiency, model
   warnings, prediction intervals, risk-of-bias coverage, GRADE/certainty coverage, and image-quality
   checks before interpreting results.
10. Use `meta_export_results` with the same `analysisId` for CSV or R artifact exports.

## Statistical constraints

- Never invent missing SD, SE, sample size, study count, p value, I-squared, tau-squared, or significance.
- Standard lnRR/MD/SMD requires the mapped statistics expected by the backend. Mean-only measures are
  allowed only when the user accepts their equal-study/cluster bootstrap interpretation.
- lnRR requires positive treatment and control means.
- MD may retain zero or negative means only after units are harmonized.
- Keep multiple effects from one study clustered by the real study identifier. Never treat effect rows
  from the same study as independent bootstrap units.
- Do not report Q, I-squared, tau-squared, Egger, funnel, or Baujat results for mean-only analyses.
- For variance-based models, distinguish a confidence interval for the pooled mean from a prediction
  interval for a future study; do not substitute one for the other.
- Numeric moderators belong in meta-regression; do not silently convert them into arbitrary subgroups.
- Treat fewer than three effects or fewer than two studies per subgroup as insufficient evidence.
- Statistical significance is not evidence certainty. If risk-of-bias or GRADE fields are absent or
  incomplete, state that limitation instead of assigning an implicit quality rating.
- Preserve user-confirmed treatment colors across all generated figures.

## Result reporting

Separate these statements:

1. What the source coding table contains.
2. What was excluded or skipped and why.
3. What the fitted model estimates.
4. What heterogeneity and subgroup/moderator analyses support.
5. What remains uncertain or sensitive to modeling choices.

When writing a paper section, use only `meta_get_results` values and registered R artifacts. Never
describe an ungenerated figure or an analysis that was merely proposed.
