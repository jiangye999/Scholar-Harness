import Link from 'next/link';

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">免责声明</h1>
        <p className="text-gray-600 mb-8">生效日期：2026年5月16日　版本：V1.3</p>

        <div className="prose prose-blue max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. 服务性质声明</h2>
            <p className="text-gray-700 mb-4">
              Scholar Harness 是学术写作辅助工具，不是论文代写服务、学术成果担保服务、投稿代理服务或科研结论认证服务。
            </p>
            <p className="text-gray-700">
              本服务可以帮助您整理材料、生成草稿建议、优化表达、辅助引用管理和提供结构化写作思路，但不能替代您的独立研究、事实核验、学术判断和最终写作责任。
            </p>
            <p className="text-gray-700 mt-4 font-medium">
              特别提示：本工具为辅助写作工具，不能代替写作；请认真、严格修改 AI 生成的文字。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. AI 输出风险</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>事实错误、逻辑遗漏或表达不准确；</li>
              <li>对研究背景、实验条件或数据含义理解不完整；</li>
              <li>引用信息错误、缺失或与原文含义不一致；</li>
              <li>生成内容与目标期刊、学校或机构规范不一致；</li>
              <li>翻译、润色或改写后改变原意；</li>
              <li>输出内容包含不适合直接发表或提交的表述。</li>
            </ul>
            <p className="text-gray-700 mt-4">
              所有 AI 输出均仅供参考。用户应在使用前进行人工审阅、事实核验、引用核验、学术规范检查和必要修改。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. 学术诚信责任</h2>
            <p className="text-gray-700 mb-4">
              用户应独立承担学术诚信责任。您不得将未经核实或未经实质性修改的 AI 输出直接作为自己的最终学术成果提交，也不得利用本服务实施论文代写、数据造假、引用造假、一稿多投、重复发表、抄袭、剽窃或其他学术不端行为。
            </p>
            <p className="text-gray-700">
              如学校、科研机构、期刊、会议或资助机构要求披露 AI 使用情况，您应主动、准确、完整地进行声明。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. 引用与文献免责</h2>
            <p className="text-gray-700 mb-4">
              Scholar Harness 可能根据用户上传的文献库、检索结果或 AI 输出提供引用建议。引用辅助不代表引用一定真实、准确、完整或适合当前论点。
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>用户应核验文献是否真实存在；</li>
              <li>用户应核对作者、年份、标题、期刊、卷期页码、DOI 等信息；</li>
              <li>用户应确认引用内容是否准确反映原文；</li>
              <li>用户应检查引用格式是否符合目标期刊或学校要求。</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. 第三方服务免责</h2>
            <p className="text-gray-700">
              本服务可能依赖您配置或明确选择的第三方 AI 模型、文本解析、PDF/OCR 处理服务，以及支付平台、验证码服务、云基础设施或网络服务。第三方服务可能出现中断、延迟、限流、价格调整、政策变更、输出质量波动或不可用。我们会尽力维护服务稳定，但无法保证第三方服务持续、准确、及时或完全符合您的预期。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. 数据与本地文件风险</h2>
            <p className="text-gray-700">
              桌面客户端可能在您的本机保存会话、草稿、文献库索引、上传材料解析结果和配置文件。我们默认不将您的上传文献、研究材料、论文草稿、对话内容或 AI 生成内容保存到我们的云端服务器。请您自行妥善保管设备、账号和重要研究材料，并定期备份重要数据。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. 用户上传内容责任</h2>
            <p className="text-gray-700">
              用户应保证上传、输入或处理的内容来源合法，不侵犯第三方知识产权、隐私权、商业秘密或其他合法权益，不包含违法、涉密、未授权或不适宜交由 AI 服务处理的资料。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. 服务结果免责</h2>
            <p className="text-gray-700">
              本服务不承诺论文、报告、项目书或其他成果达到特定质量，不承诺论文投稿、学位审核、项目申报或评审一定通过，也不承诺 AI 输出一定符合目标期刊格式、审稿意见或导师要求。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. 联系我们</h2>
            <p className="text-gray-700">
              如有疑问，请联系：
              <a href="mailto:sjs@cau.edu.cn" className="text-blue-600 hover:text-blue-700 ml-1">
                sjs@cau.edu.cn
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <Link href="/terms" className="text-blue-600 hover:text-blue-700">
              查看用户协议
            </Link>
            <Link href="/" className="text-blue-600 hover:text-blue-700">
              返回首页
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
