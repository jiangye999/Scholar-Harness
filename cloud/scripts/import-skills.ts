/**
 * Skill 导入脚本
 * 将本地 sci_writing_skills 目录中的 Skill 文件加密后导入到数据库
 */

// 加载环境变量
try {
  require('dotenv/config');
} catch (e) {
  // dotenv 模块不存在时忽略
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { encryptPrompt, hashPrompt } from '../prompts/encryption';
import { DatabaseConnection } from '../database';

interface SkillFile {
  id: string;
  name: string;
  content: string;
  language: 'zh' | 'en';
}

/**
 * 解析 Skill ID 从文件名
 */
function parseSkillId(filename: string): string {
  // 运行时代码按完整文件名前缀请求，例如 03_introduction_skill.md -> 03_introduction_skill
  return filename.replace(/\.md$/i, '');
}

/**
 * 解析 Skill 名称从文件内容
 */
function parseSkillName(content: string): string {
  const match = content.match(/^#\s*(.+?)\s*$/m);
  if (match) {
    return match[1].replace('SCI ', '').replace(' Writing Skill', '');
  }
  return 'Unknown Skill';
}

/**
 * 检测语言
 */
function detectLanguage(content: string): 'zh' | 'en' {
  // 检测是否包含中文
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(content) ? 'zh' : 'en';
}

/**
 * 读取 Skill 文件
 */
async function readSkillFiles(skillsDir: string): Promise<SkillFile[]> {
  const skills: SkillFile[] = [];
  
  try {
    const files = await fs.readdir(skillsDir);
    
    for (const file of files) {
      if (!file.endsWith('_skill.md')) continue;
      
      const filePath = path.join(skillsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const id = parseSkillId(file);
      const name = parseSkillName(content);
      const language = detectLanguage(content);
      
      skills.push({
        id,
        name,
        content,
        language,
      });
      
      console.log(`  [Read] ${file} -> ${id} (${language})`);
    }
  } catch (error) {
    console.error(`  [Error] Failed to read skills directory: ${error}`);
  }
  
  return skills;
}

/**
 * 导入 Skill 到数据库
 */
async function importSkillToDatabase(db: DatabaseConnection, skill: SkillFile): Promise<boolean> {
  try {
    // 加密内容
    const encrypted = encryptPrompt(skill.content);
    const hash = hashPrompt(skill.content);
    
    // 检查是否已存在
    const existing = await db.queryOne<{ version: number }>(
      `SELECT version FROM prompts WHERE id = $1`,
      [skill.id]
    );
    
    if (existing) {
      // 更新现有记录
      await db.query(
        `UPDATE prompts 
         SET name = $2, content_encrypted = $3, content_hash = $4, version = $5, language = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [skill.id, skill.name, encrypted, hash, existing.version + 1, skill.language]
      );
      
      // 记录版本变更
      await db.query(
        `INSERT INTO prompt_versions (prompt_id, version, changelog) 
         VALUES ($1, $2, 'Skill content updated')`,
        [skill.id, existing.version + 1]
      );
      
      console.log(`  [Update] ${skill.id} -> v${existing.version + 1}`);
    } else {
      // 插入新记录
      await db.query(
        `INSERT INTO prompts (id, name, category, content_encrypted, content_hash, version, language) 
         VALUES ($1, $2, 'writing', $3, $4, 1, $5)`,
        [skill.id, skill.name, encrypted, hash, skill.language]
      );
      
      console.log(`  [Insert] ${skill.id} -> v1`);
    }
    
    return true;
  } catch (error) {
    console.error(`  [Error] Failed to import ${skill.id}: ${error}`);
    return false;
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('\n=== Skill Import Script ===\n');
  
  // 解析参数
  const args = process.argv.slice(2);
  const skillsDir = args.find(a => a.startsWith('--skills-dir='))?.split('=')[1] 
    || './sci_writing_skills';
  
  console.log(`Skills directory: ${skillsDir}\n`);
  
  // 连接数据库
  const db = new DatabaseConnection();
  
  try {
    await db.connect();
    console.log('[DB] Connected\n');
    
    // 读取 Skill 文件
    console.log('[Read] Reading skill files...');
    const skills = await readSkillFiles(skillsDir);
    console.log(`\n[Info] Found ${skills.length} skill files\n`);
    
    if (skills.length === 0) {
      console.log('[Warning] No skill files found. Exiting.');
      return;
    }
    
    // 导入到数据库
    console.log('[Import] Importing to database...');
    let successCount = 0;
    
    for (const skill of skills) {
      const success = await importSkillToDatabase(db, skill);
      if (success) successCount++;
    }
    
    console.log(`\n[Result] Imported ${successCount}/${skills.length} skills\n`);
    
    // 验证导入
    console.log('[Verify] Verifying imports...');
    const importedSkills = await db.query<{ id: string; name: string; version: number }>(
      `SELECT id, name, version FROM prompts WHERE category = 'writing' ORDER BY id`
    );
    
    console.log('\nImported skills:');
    for (const s of importedSkills) {
      console.log(`  - ${s.id}: ${s.name} (v${s.version})`);
    }
    
  } catch (error) {
    console.error(`\n[Error] Import failed: ${error}`);
    process.exit(1);
  } finally {
    await db.disconnect();
    console.log('\n[DB] Disconnected');
  }
}

// 运行
main().catch(console.error);
