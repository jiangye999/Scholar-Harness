/**
 * Prompt 表迁移
 * 创建 prompts、prompt_versions、prompt_usage 表
 */

-- ============================================
-- prompts 表（加密存储 Skill 和 Agent Prompt）
-- ============================================
CREATE TABLE IF NOT EXISTS prompts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'writing',
  language VARCHAR(5) NOT NULL DEFAULT 'zh',
  version INTEGER NOT NULL DEFAULT 1,
  content_encrypted TEXT NOT NULL,        -- AES-256 加密内容
  content_hash VARCHAR(64) NOT NULL,      -- SHA-256 内容哈希（用于验证）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
CREATE INDEX IF NOT EXISTS idx_prompts_version ON prompts(version);

-- ============================================
-- prompt_versions 表（版本控制）
-- ============================================
CREATE TABLE IF NOT EXISTS prompt_versions (
  id SERIAL PRIMARY KEY,
  prompt_id VARCHAR(50) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  changelog TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id);

-- ============================================
-- prompt_usage 表（用量追踪）
-- ============================================
CREATE TABLE IF NOT EXISTS prompt_usage (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_type VARCHAR(20) NOT NULL,       -- 'skill_get', 'generate', 'write', 'skill_cache'
  prompt_id VARCHAR(50),
  credits_consumed INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引（用于统计查询）
CREATE INDEX IF NOT EXISTS idx_prompt_usage_user ON prompt_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_usage_type ON prompt_usage(prompt_type);

-- ============================================
-- 初始 Skill 数据（示例）
-- ============================================
-- 实际 Skill 内容需要通过导入脚本添加
-- 这里仅创建空记录作为占位符

INSERT INTO prompts (id, name, category, language, content_encrypted, content_hash, version)
VALUES 
  ('01_title_skill', 'Title Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('02_abstract_skill', 'Abstract Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('03_introduction_skill', 'Introduction Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('04_methods_skill', 'Methods Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('05_results_skill', 'Results Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('06_figures_tables_skill', 'Figures Tables Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('07_discussion_skill', 'Discussion Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('08_conclusion_skill', 'Conclusion Writing Skill', 'writing', 'en', 'placeholder', 'placeholder', 1),
  ('09_additional_statements_skill', 'Additional Statements Skill', 'writing', 'en', 'placeholder', 'placeholder', 1)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 触发器：自动更新 updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_prompt_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_prompt_updated_at ON prompts;
CREATE TRIGGER trigger_update_prompt_updated_at
BEFORE UPDATE ON prompts
FOR EACH ROW
EXECUTE FUNCTION update_prompt_updated_at();

-- ============================================
-- 视图：用户 Prompt 使用统计
-- ============================================
CREATE OR REPLACE VIEW user_prompt_stats AS
SELECT 
  user_id,
  COUNT(*) as total_requests,
  SUM(credits_consumed) as total_credits,
  COUNT(CASE WHEN prompt_type = 'generate' THEN 1 END) as generate_count,
  COUNT(CASE WHEN prompt_type = 'write' THEN 1 END) as write_count,
  COUNT(CASE WHEN prompt_type = 'skill_get' THEN 1 END) as skill_get_count,
  MAX(created_at) as last_request_at
FROM prompt_usage
GROUP BY user_id;

-- ============================================
-- 完成迁移
-- ============================================
-- 迁移完成时间：2026-04-25
-- 版本：v1.0.0