import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">用户协议</h1>
        <p className="text-gray-600 mb-8">生效日期：2026年5月16日　版本：V1.3</p>

        <div className="prose prose-blue max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. 服务说明</h2>
            <p className="text-gray-700 mb-4">
              Scholar Harness 是一款学术论文写作辅助工具，提供文献管理、研究材料整理、实验资料总结、数据总结、对话式写作、草稿生成、引用辅助和格式整理等功能。
            </p>
            <p className="text-gray-700">
              本服务的定位是辅助用户提升学术写作效率，不是论文代写、论文买卖、学术成果承诺或投稿保证服务。用户应对自己的研究设计、数据真实性、论文观点、最终表达和投稿行为负责。
            </p>
            <p className="text-gray-700 mt-4 font-medium">
              特别提示：本工具为辅助写作工具，不能代替写作；请认真、严格修改 AI 生成的文字。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. 账号注册与使用</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>注册时应提供真实、准确、可使用的邮箱等信息。</li>
              <li>注册时必须填写有效内测码，并按要求完成邮箱验证、人机验证或其他安全验证。</li>
              <li>用户应妥善保管账号、密码、验证码、登录令牌、API Key 和本地数据。</li>
              <li>内测码不得出售、倒卖、批量滥用或用于非授权用途。</li>
              <li>发现账号异常、数据异常或疑似被盗用时，应及时联系我们。</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. 用户责任与学术诚信</h2>
            <p className="text-gray-700 mb-4">
              您理解并同意，学术诚信责任由用户自行承担。使用 Scholar Harness 时，您应遵守所在学校、科研机构、期刊、会议和资助机构关于 AI 辅助工具、论文写作、引用标注和数据真实性的规则。
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>不得利用本服务进行论文代写、买卖论文或规避学术诚信审查；</li>
              <li>不得伪造、篡改或虚构研究数据、实验结果、图片、图表或引用；</li>
              <li>不得将未经核实的 AI 输出直接作为最终学术成果提交；</li>
              <li>不得上传、传播或处理违法、侵权、涉密、未授权或不适宜交由第三方处理的资料；</li>
              <li>不得攻击、破解、逆向、爬取、干扰或滥用本服务。</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. AI 输出与引用核验</h2>
            <p className="text-gray-700 mb-4">
              AI 输出可能存在事实错误、表达不当、逻辑遗漏、引用不准确、引用缺失或不符合目标期刊要求等问题。系统提供的引用、文献匹配和格式建议仅用于辅助，不能替代人工核验。
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>核实文献是否真实存在；</li>
              <li>核对作者、年份、题名、期刊、DOI 等引用信息；</li>
              <li>确认内容与原文含义一致；</li>
              <li>检查是否符合目标期刊和所在机构的规范；</li>
              <li>对最终论文内容承担完整责任。</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. 用户内容与知识产权</h2>
            <p className="text-gray-700 mb-4">
              您上传的文献、研究材料、数据说明、图片、表格、草稿和其他内容，应当由您合法拥有或已取得必要授权。
            </p>
            <p className="text-gray-700">
              在您使用本服务期间，相关用户内容默认保存在您的本地设备中。我们不会将您的上传文献、研究材料、论文草稿、对话内容或 AI 生成内容保存到我们的云端服务器。为实现您请求的功能，相关内容可能会在本地被读取、解析、转换、检索、生成和展示；当您配置或明确选择第三方 API 服务时，相关内容可能会发送给您配置的服务商处理。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. 第三方服务</h2>
            <p className="text-gray-700">
              本服务可能调用您配置或明确选择的第三方 AI 模型、文件解析服务，以及支付平台、验证码服务、云基础设施或其他必要账户服务。第三方服务可能有独立的服务条款、隐私政策、价格规则和可用性限制。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. 付费、订阅与退款</h2>
            <p className="text-gray-700">
              如本服务提供付费功能、订阅、套餐或权益包，具体价格、有效期、功能范围、用量限制和退款条件以购买页面、订单页面或另行公示的规则为准。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. 服务变更、中断与终止</h2>
            <p className="text-gray-700">
              我们可能因产品升级、系统维护、网络故障、第三方服务变化、安全风险、法律法规要求或不可抗力调整、中断或终止部分服务。如您违反本协议、法律法规或相关规则，我们有权视情况采取提醒、限制功能、暂停服务、冻结账号、终止服务等措施。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. 免责声明与责任限制</h2>
            <p className="text-gray-700">
              本服务仅提供学术写作辅助，不保证 AI 输出完全准确、完整、适用或符合特定投稿要求；不保证论文被录用、项目通过、学位授予或获得任何学术成果。详细说明请阅读
              <Link href="/disclaimer" className="text-blue-600 hover:text-blue-700 ml-1">
                免责声明
              </Link>
              。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">10. 协议更新与争议解决</h2>
            <p className="text-gray-700">
              我们可能根据法律法规、产品功能、运营策略或安全要求更新本协议。因本协议或本服务产生争议的，双方应优先友好协商解决；协商不成的，可依法向有管辖权的人民法院提起诉讼。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">11. 联系我们</h2>
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
            <Link href="/" className="text-blue-600 hover:text-blue-700">
              返回首页
            </Link>
            <Link href="/privacy" className="text-blue-600 hover:text-blue-700">
              查看隐私政策
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
