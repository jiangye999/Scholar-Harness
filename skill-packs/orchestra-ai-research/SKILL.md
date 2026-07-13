---
name: ai-research-skills
description: Route AI and machine-learning research tasks to the relevant skill from Orchestra Research's 98-skill library. Use for autonomous AI research, research ideation, ML paper writing, model architecture, tokenization, fine-tuning, interpretability, data processing, post-training, alignment, distributed training, optimization, evaluation, inference, MLOps, agents, RAG, multimodal systems, and research rigor.
---

# AI Research SKILLs Router

Use this Skill as the entry point to the vendored Orchestra Research AI Research SKILLs library. Do not load all 98 sub-skills into context.

## Workflow

1. Read `INDEX.md` and identify the smallest set of sub-skills that materially helps the current request.
2. Read the complete matching `vendor/<category>/<skill>/SKILL.md` before applying it.
3. Read that sub-skill's references or scripts only when needed for the task.
4. Combine at most a few complementary sub-skills. Avoid loading overlapping framework guides.
5. State important environment and version assumptions before executing framework-specific commands.

## Routing Priorities

- Use `vendor/0-autoresearch-skill/SKILL.md` only when the user asks for an end-to-end autonomous AI research workflow. Do not start a research loop for a narrow question.
- Prefer the ideation and ML paper-writing categories for research questions, experimental framing, paper structure, academic plotting, and citation-aware ML writing.
- Prefer framework-specific categories only when the user's project or query actually names that framework or capability.
- Use the agent-native research artifact and rigor-reviewer resources for reproducible research artifacts and methodological auditing.

## Scholar Harness Compatibility

- Current user instructions, verified evidence, target-venue requirements, and Scholar Harness safety rules override conflicting vendored text.
- A sub-skill is guidance, not permission. Do not install packages, execute scripts, access networks, or modify files unless the active tool permissions and user request allow it.
- Work inside the configured AI safety workspace when modifying project files. Preserve source data and create backups according to the workspace policy.
- Do not invent citations, benchmark scores, package APIs, model support, or version compatibility. Verify time-sensitive claims against official primary documentation.
- Use Scholar Harness PDF Wiki and literature tools for academic evidence and citation mapping rather than treating a sub-skill's examples as sources.
- Keep user-confirmed plotting colors, draft chapter targets, and output formats intact.

## Source

The vendored resources come from `Orchestra-Research/AI-Research-SKILLs` at the commit recorded in `pack.json`. See `LICENSE` and `NOTICE.md` for attribution and terms.
