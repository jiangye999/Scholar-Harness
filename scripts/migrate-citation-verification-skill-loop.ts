import * as fs from 'fs/promises';
import * as path from 'path';

interface UserSkillRecord {
  id?: string;
  name?: string;
  prompt?: string;
  updatedAt?: string;
}

interface UserSkillFile {
  version?: number;
  updatedAt?: string;
  skills?: UserSkillRecord[];
}

const TARGET_SKILL_ID = 'b8c581f0-e1c9-45e7-b401-deb8616dd2d8';
const TARGET_SKILL_NAME = '论文逐句参考文献支撑与尾注匹配核验 Skill';

const LOOP_PROTOCOL = `### 39.0 强制闭环批次（Loop，不得先搜完再评审）

必须把待处理参考文献队列切分为 5–10 篇一批，并按以下闭环持续运行：

\`\`\`text
选择下一批 5–10 篇待处理尾注
    ↓
逐篇使用完整标题在 Embedding 文献库精确检索
    ↓
仅对 Embedding 无命中项用同一完整标题回退 PDF Wiki
    ↓
确认文献身份并生成或复用证据卡片
    ↓
立即找到正文中引用本批文献的句子与原子主张
    ↓
逐文献、逐主张完成支撑度评审
    ↓
立即合并写入工作报告和批次检查点
    ↓
提交本批状态，再进入下一批
\`\`\`

严禁先完成全部文献检索，再统一进行句子评审。检索、评审和报告写入必须处于同一个批次循环中。

默认配置：

\`\`\`yaml
batch_size: 5
batch_size_max: 10
commit_after_each_batch: true
resume_from_checkpoint: true
continue_after_single_reference_failure: true
\`\`\`

只有当文献内容较短、均已有有效缓存且上下文预算允许时，单批才可从 5 提高到 10；不得超过 10。

每一批都是一个原子事务，完成条件为：

1. 本批每篇文献都有检索状态；
2. 命中文献已有证据卡片或明确记录降级原因；
3. 引用本批文献的句子均已完成原子主张评审；
4. 单篇结果和本批联合支撑结果已经写入工作报告；
5. 批次 JSON 检查点已原子落盘；
6. 任务清单中的文献、句子和主张状态已更新。

任一步骤未完成时，不得把该批标记为 \`COMMITTED\`，也不得静默进入下一批。

### 39.0.1 持久化目录

在用户当前工作目录创建：

\`\`\`text
citation-verification/
├─ manifest.json
├─ evidence-cards/
├─ checkpoints/
│  ├─ batch-0001.json
│  ├─ batch-0002.json
│  └─ ...
├─ report/
│  ├─ working-report.md
│  └─ final-report.md
└─ audit-log.jsonl
\`\`\`

- \`manifest.json\`：记录文档哈希、Skill 版本、批次大小、总文献数、总句子数、状态计数和最后提交批次。
- \`evidence-cards/\`：每篇文献一张可复用证据卡片。
- \`checkpoints/batch-NNNN.json\`：保存该批输入、检索结果、证据卡片 ID、句子评审、失败项和提交时间。
- \`working-report.md\`：每批提交后立即合并更新，用户可在任务未结束时查看。
- \`final-report.md\`：全部批次完成后统一去重、交叉复核和格式化的最终报告。
- \`audit-log.jsonl\`：以追加方式记录检索、降级、评审、重试和写入事件。

写文件时先写同目录临时文件，再原子替换目标文件，防止中断造成半份 JSON 或半份报告。

### 39.0.2 批次状态

\`\`\`text
PENDING
RETRIEVING
EVIDENCE_READY
VERIFYING
WRITING
COMMITTED
COMMITTED_WITH_WARNINGS
FAILED_RETRYABLE
FAILED_FINAL
\`\`\`

启动或恢复任务时，必须先读取 \`manifest.json\` 和已有检查点：

- 跳过 \`COMMITTED\` 与 \`COMMITTED_WITH_WARNINGS\` 批次；
- 重试 \`FAILED_RETRYABLE\`；
- 保留 \`FAILED_FINAL\` 并在最终报告列出；
- 不重复检索已有有效证据卡片的文献；
- 不重复评审输入哈希、证据卡片哈希和规则版本均未变化的主张。

### 39.0.3 每批报告写入

每批至少写入：

1. 批次编号和覆盖的参考文献；
2. 每篇文献的标题精确检索状态；
3. 对应正文句子和原子主张；
4. 单篇支撑等级、置信度、证据位置和理由；
5. 本批内多文献联合支撑结论；
6. 修改建议；
7. 未命中、身份冲突、无全文和失败项；
8. 累计进度：已处理文献数/总文献数、已评审主张数/总主张数。

工作报告按稳定主键 \`sentence_id + claim_id + reference_id\` 合并，禁止断点恢复时重复追加相同记录。

`;

const EARLY_LOOP_PROTOCOL = `## 1.3 强制 Loop 执行协议

本 Skill 启动后，必须采用闭环批次，而不是“全部检索完成后再统一评审”：

1. 先全量解析正文、引文、尾注和句子—文献映射，只建立任务清单，不预先批量检索全部文献；
2. 每次从未完成队列选择 5 篇文献；仅当已有缓存且上下文允许时可增加到 10 篇，绝不超过 10 篇；
3. 在同一个 Loop 中依次完成：
   - 用每篇尾注的完整标题精确检索 Embedding；
   - 仅对 Embedding 无命中项用同一标题回退 PDF Wiki；
   - 生成或复用证据卡片；
   - 立即评审正文中引用本批文献的句子和原子主张；
   - 立即写入工作报告、批次 JSON 检查点和审计日志；
4. 只有本批写入成功并标记 \`COMMITTED\` 后，才能处理下一批；
5. 中断恢复时跳过已提交批次，不重复检索、重复评审或重复写入；
6. 全部批次结束后，只做跨批联合支撑复核、去重、排序和统一格式化，生成最终报告。

批次失败不得丢弃已完成结果。单篇失败应记录为 U、待复核或最终失败，并继续处理本批其他文献。

`;

const LOOP_PSEUDOCODE = `## 48. 闭环调度伪代码

\`\`\`python
paper = ingest_document(input_file)
sentences = parse_sentences(paper)
reference_entries = parse_all_references(paper)
citation_graph = build_initial_citation_graph(sentences, reference_entries)
claims = decompose_all_atomic_claims(sentences)

state = load_or_create_manifest(
    document_hash=paper.content_hash,
    skill_version="2.2.0",
    batch_size=choose_batch_size(minimum=5, maximum=10),
)
queue = build_priority_queue(reference_entries, claims, citation_graph, state)

while queue.has_uncommitted_items():
    batch = queue.next_batch(size=state.batch_size)
    checkpoint = begin_batch_checkpoint(batch)

    try:
        for reference in batch:
            resolved = retrieve_reference_by_full_title(
                reference,
                primary_source="embedding",
                fallback_source="pdf_wiki",
                fallback_only_after_primary_miss=True,
                allow_keyword_query_generation=False,
            )
            checkpoint.save_retrieval(resolved)

            evidence_card = load_valid_cached_evidence_card(resolved)
            if evidence_card is None:
                evidence_card = extract_evidence_card(resolved)
                save_evidence_card_atomically(evidence_card)
            checkpoint.save_evidence_card(evidence_card)

            related_claims = claims_citing_reference(
                reference,
                claims,
                citation_graph,
            )
            for claim in related_claims:
                result = verify_claim_against_reference(claim, evidence_card)
                checkpoint.save_verification(result)

        for claim in checkpoint.affected_claims():
            per_reference_results = load_all_available_results_for_claim(claim)
            joint_result = analyze_joint_support(claim, per_reference_results)
            checkpoint.save_joint_result(joint_result)

        merge_batch_into_working_report(
            checkpoint,
            key=("sentence_id", "claim_id", "reference_id"),
        )
        checkpoint.commit_atomically()
        update_manifest_atomically(checkpoint)
        emit_progress(checkpoint)
    except RetryableError as error:
        checkpoint.mark_retryable(error)
        checkpoint.persist_atomically()
    except Exception as error:
        checkpoint.mark_final_failure(error)
        checkpoint.persist_atomically()
        merge_failure_into_working_report(checkpoint)

run_cross_batch_joint_support_analysis()
run_quality_control_checks(citation_graph)
deduplicate_and_normalize_report()
generate_final_report_from_committed_checkpoints()
\`\`\`

关键约束：

- \`retrieve_reference_by_full_title\` 与 \`verify_claim_against_reference\` 必须在同一批循环内发生；
- 每批结束必须先落盘，再开始下一批；
- 最终报告只能从已提交检查点和明确失败记录生成，不得重新凭记忆概括；
- 最终统一格式阶段只负责去重、排序、跨批联合支撑和版式，不得覆盖批次中的原始证据判断。

`;

function replaceSection(
  source: string,
  startHeading: string,
  nextHeading: string,
  replacement: string,
): string {
  const start = source.indexOf(startHeading);
  const end = source.indexOf(nextHeading, start + startHeading.length);
  if (start < 0 || end < 0) {
    throw new Error(`无法定位 Skill 章节：${startHeading}`);
  }
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}

function upgradePrompt(rawPrompt: string): string {
  let prompt = String(rawPrompt || '');
  if (!prompt.trim()) throw new Error('目标 Skill 指令为空');

  prompt = prompt.replace(/^version:\s*2\.1\.0$/m, 'version: 2.2.0');
  prompt = prompt.replace(
    /version:\s*2\.0\.0/g,
    'version: 2.2.0',
  );
  prompt = prompt.replace(
    '根据风险、引用频率和章节重要性排序\n    ↓\n分批并发获取摘要、全文和补充材料\n    ↓\n每篇文献只解析一次并生成证据卡片\n    ↓\n将句子拆分为原子主张\n    ↓\n逐主张、逐文献核验\n    ↓\n分析多篇文献能否联合支撑\n    ↓\n输出修改建议、证据矩阵和审计报告',
    '根据风险、引用频率和章节重要性排序\n    ↓\n切分为每批 5–10 篇的闭环队列\n    ↓\n本批精确检索并生成或复用证据卡片\n    ↓\n立即核验引用本批文献的句子与原子主张\n    ↓\n立即写入工作报告和批次检查点\n    ↓\n循环处理下一批\n    ↓\n跨批联合支撑复核并统一生成最终报告',
  );
  prompt = prompt.replace('## 1.1 Skill 2.0 的完整能力边界', '## 1.1 Skill 2.2 的完整能力边界');
  prompt = prompt.replace('## 53. 最终完成标准 2.0', '## 53. 最终完成标准 2.2');

  if (prompt.includes('## 1.3 强制 Loop 执行协议')) {
    prompt = replaceSection(
      prompt,
      '## 1.3 强制 Loop 执行协议',
      '## 2. 适用场景',
      EARLY_LOOP_PROTOCOL.trimEnd(),
    );
  } else {
    prompt = prompt.replace('## 2. 适用场景', `${EARLY_LOOP_PROTOCOL}## 2. 适用场景`);
  }

  if (prompt.includes('### 39.0 强制闭环批次')) {
    prompt = replaceSection(
      prompt,
      '### 39.0 强制闭环批次',
      '### 39.1 默认并发建议',
      LOOP_PROTOCOL.trimEnd(),
    );
  } else {
    prompt = prompt.replace('### 39.1 默认并发建议', `${LOOP_PROTOCOL}### 39.1 默认并发建议`);
  }

  if (prompt.includes('## 48. 闭环调度伪代码')) {
    prompt = replaceSection(
      prompt,
      '## 48. 闭环调度伪代码',
      '## 49. 失败降级矩阵',
      LOOP_PSEUDOCODE.trimEnd(),
    );
  } else {
    prompt = replaceSection(
      prompt,
      '## 48. 调度伪代码',
      '## 49. 失败降级矩阵',
      LOOP_PSEUDOCODE.trimEnd(),
    );
  }

  prompt = prompt.replace(
    /## 54\. 一句话执行规则[\s\S]*$/,
    `## 54. 一句话执行规则

> 先全量解析正文、引文和尾注并建立任务清单；随后严格循环执行“选取 5–10 篇尾注 → 按完整标题在 Embedding 精确检索 → 仅无命中时回退 PDF Wiki → 建证据卡片 → 立即评审引用这些文献的句子与原子主张 → 原子写入工作报告和检查点”，上一批提交后才能进入下一批；全部批次结束后再统一去重、跨批联合支撑分析和格式化最终报告。`,
  );

  prompt = prompt.replace(
    'metadata_batch_size: 20',
    'metadata_batch_size: 5\n  closed_loop_batch_size_min: 5\n  closed_loop_batch_size_max: 10',
  );
  prompt = prompt.replace(
    'reporting:\n  include_sentence_table: true',
    'reporting:\n  write_after_each_batch: true\n  atomic_checkpoint: true\n  resumable_working_report: true\n  include_sentence_table: true',
  );

  if (!prompt.includes('version: 2.2.0')) {
    throw new Error('Skill 版本升级失败');
  }
  return prompt;
}

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root) {
    throw new Error('用法：tsx scripts/migrate-citation-verification-skill-loop.ts <user-skills-root>');
  }

  const userDirs = await fs.readdir(root, { withFileTypes: true });
  let matchedCount = 0;
  let updatedCount = 0;
  for (const userDir of userDirs) {
    if (!userDir.isDirectory()) continue;
    const filePath = path.join(root, userDir.name, 'skills.json');
    let parsed: UserSkillFile;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as UserSkillFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
    const skill = skills.find(item => (
      item.id === TARGET_SKILL_ID
      || String(item.name || '').trim() === TARGET_SKILL_NAME
    ));
    if (!skill?.prompt) continue;
    matchedCount += 1;

    const nextPrompt = upgradePrompt(skill.prompt);
    if (nextPrompt === skill.prompt) continue;
    const now = new Date().toISOString();
    skill.prompt = nextPrompt;
    skill.updatedAt = now;
    parsed.updatedAt = now;

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(parsed, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
    updatedCount += 1;
    process.stdout.write(`updated ${filePath}\n`);
  }

  if (matchedCount === 0) {
    throw new Error('未找到需要升级的逐句引用核验 Skill');
  }
  if (updatedCount === 0) {
    process.stdout.write(`citation verification Skill already uses Loop 2.2.0 (${matchedCount})\n`);
    return;
  }
  process.stdout.write(`citation verification Skill upgraded to 2.2.0 (${updatedCount})\n`);
}

main().catch((error) => {
  process.stderr.write(`${(error as Error)?.stack || String(error)}\n`);
  process.exitCode = 1;
});
