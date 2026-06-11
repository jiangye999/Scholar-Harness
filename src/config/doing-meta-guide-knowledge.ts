export const DOING_META_GUIDE_SOURCE = 'https://doing-meta.guide/';

export const DOING_META_GUIDE_KNOWLEDGE = `
Source: Doing Meta-Analysis with R / doing-meta.guide
Use this as an embedded method knowledge pack for Scholar Harness Meta Analysis. It is a distilled engineering reference, not a verbatim copy.

Core workflow:
1. Define the research question, eligible studies, outcomes, contrasts, and extraction rules before modeling.
2. Convert each study outcome into an effect size yi and sampling variance vi. Keep the original mean, SD/SE, n, group labels, unit, study id, and evidence text.
3. Inspect data quality before pooling: missing mean/SD/n, non-positive means for log response ratios, invalid variances, duplicated effects, inconsistent units, and multiple effects from the same study.
4. Choose effect measure according to data structure:
   - lnRR / log response ratio: treatment and control means are positive and a relative ecological/agronomic response is needed.
   - MD / mean difference: all outcomes share the same unit and scale.
   - SMD / Hedges g: outcomes measure the same construct on different scales.
   - Proportions, correlations, odds ratios, risk ratios, hazard ratios, and diagnostic metrics require their dedicated transformations and variances.
5. Pool effect sizes with inverse-variance weights. Prefer random-effects models for real literature syntheses unless a common-effect assumption is defensible.
6. Estimate and report heterogeneity: Q, df, tau2, I2, prediction interval when useful, and reasons for heterogeneity.
7. Visualize with forest plots. Include study label, effect estimate, confidence interval, pooled effect, heterogeneity, subgroup labels when used, and model method.
8. If k is low, avoid over-interpreting funnel plots, Egger tests, trim-and-fill, and meta-regression.
9. Use subgroup analysis for categorical variables selected from the protocol or user request. Each subgroup should have enough effects to be interpretable.
10. Use meta-regression for continuous or ordered moderators. Treat it as exploratory when studies/effects are few. Report coefficient, CI, p-value, tau2 change, and limitations.
11. For multiple effects per study, prefer multilevel/mixed-effects modeling or cluster-robust variance estimation instead of treating effects as independent.
12. Check robustness with leave-one-out influence diagnostics, Baujat/influence plots, and sensitivity analysis excluding high-risk or extreme observations.
13. Assess publication bias/small-study effects only when enough studies exist. Funnel asymmetry tests generally require about k >= 10.
14. Report methods transparently: databases, inclusion criteria, extraction decisions, effect-size formula, model type, tau2 estimator, software/packages, subgroup/moderator rules, and limitations.
15. Reproducible R output should save CSV inputs, R script, model summaries, forest plots, funnel plots, sensitivity plots, subgroup plots, and diagnostics.

Data engineering rules for this product:
- Always operate on a copy workspace first. Never directly mutate the original coding table without explicit user confirmation.
- A cell intended to hold a numeric mean must contain only the mean. If a cell contains "mean ± SD", "mean ± SE", confidence intervals, letters, or units, split or normalize first.
- If a value is a range such as "10-20", use the midpoint for numeric modeling and keep a note in operations/warnings.
- If SD is required but only SE is present, convert with SD = SE * sqrt(n). If CI is present, derive SE/SD only when the confidence level and n are known.
- Units for the same outcome must be unified before pooling. Record the target unit in the column header or metadata.
- For lnRR, treatment mean and control mean must both be > 0. Rows that violate this must be skipped or analyzed with another measure.
- For SD, negative values are invalid. Zero SD should be warned and usually skipped unless a continuity/imputation rule is explicitly chosen.
- n must be the group sample size, not observation id, row number, year, replicate label, or number of measurements unless that is the study-defined n.
- Subgroup columns are used after effect sizes are computed. They are not treatment/control mean/SD/n columns.
- Range grouping syntax should be concise and explicit, e.g. "0-30=short;30-90=medium;>90=long".

R generation rules:
- Prefer metafor for effect-size models and diagnostics; use meta where its forest/funnel helpers are useful.
- Generate at least: effect size CSV, reproducible R script, pooled model summary, forest plot, funnel plot, leave-one-out sensitivity, Baujat/influence diagnostics, subgroup outputs when selected, and meta-regression outputs when selected.
- Use REML random-effects as default. Use fixed/common only when explicitly requested. Use mixed/multilevel when effects are clustered by study.
- For cluster-robust inference, use clubSandwich when available; otherwise report that robust inference was skipped.
- If k < 10, still draw exploratory funnel plots if useful, but do not present Egger/publication-bias tests as reliable.
- Every plot file should have stable names including outcome id and analysis type.

Assistant behavior:
- Ask targeted questions only when the data cannot support a safe decision.
- Prefer concrete operations over vague advice: split columns, convert units, map roles, group ranges, run model, generate plots.
- Explain why an operation is needed, what it changes, and whether it requires confirmation.
- If user asks to analyze directly, produce a runnable suggestedConfig and proceed through analysis/plotting if the UI supports it.
`;
