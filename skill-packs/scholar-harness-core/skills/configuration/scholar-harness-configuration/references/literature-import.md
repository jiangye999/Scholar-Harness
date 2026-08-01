# WoS / CNKI 文献导出与 Scholar Harness 上传

界面名称可能因数据库语言、机构订阅和版本略有不同。先按“记录内容是否完整”判断，不只依赖按钮文字。

## Web of Science

### 用于文献计量的推荐格式

1. 在 Web of Science Core Collection 完成检索。
2. 勾选当前页、指定记录范围，或先加入 Marked List。
3. 选择 `Export` / `导出` → `Plain text file`。
4. Record Content 选择 `Full Record and Cited References`。
5. 下载 `.txt`。记录较多时按平台单批上限分批导出，文件可一起上传，勿手工拼接破坏 `ER` / `EF` 标签。
6. 在 Scholar Harness 使用“文献题录上传”。需要计量学时，Plain Text 必须包含完整记录和 cited references。

### 用于通用题录库

可选择 RIS 或 Plain Text。RIS 适合跨文献管理器交换；Plain Text 保留 WoS 两字符字段标签，Scholar Harness 两者都可识别。

官方说明：

- https://webofscience.help.clarivate.com/en-us/Content/export-records.htm
- https://webofscience.help.clarivate.com/Content/full-record.htm

## 中国知网 CNKI

1. 在检索结果页勾选需要的记录。
2. 选择 `导出与分析` / `导出` / `引用`。
3. 优先选择 `Refworks`、`EndNote`、`NoteExpress` 等结构化题录格式并下载；如果页面提供 RIS，直接下载 RIS。
4. 如果只能复制文本，选择尽量包含题名、作者、来源、年份、摘要、关键词和 DOI 的格式，保存为 UTF-8 `.txt`。
5. 在 Scholar Harness 使用“文献题录上传”，可一次选择多个 `.ris` / `.txt` 文件。

CNKI 不同入口给出的按钮可能不同。不要把 GB/T 7714 格式化引文误当作完整题录：只有引文文本时，摘要和关键词通常缺失，检索能力会下降。

## PDF 全文

PDF 不走题录上传。使用“PDF Wiki 上传”，系统会提取原文句子、论点、显式文中引用和尾注参考文献。RIS/TXT 不能替代 PDF 原文，PDF 也不能替代 WoS cited references 的计量字段。

## 上传后的检查

- 数量是否与导出记录数大致一致；
- 中文是否乱码；乱码时重新导出或转为 UTF-8；
- WoS 计量学是否检测到 `FN`/`VR`、`PT`、`UT`、`CR`、`ER` 等标签；
- CNKI 是否至少包含题名、作者、来源和年份；
- 重复文件会按现有去重规则排除，但仍应避免把同一批次重复选中。

## 常见错误

- WoS 只导出 `Full Record`，没有 `Cited References`：可以建立普通题录库，但共被引和文献耦合会缺数据。
- 下载的是网页 HTML 而非 TXT/RIS：返回导出菜单重新下载。
- CNKI 只复制 GB/T 7714 引文：可用于参考文献格式，不适合作为高质量摘要检索库。
- 把 RIS/TXT 上传到 PDF Wiki：应改用文献题录上传。
