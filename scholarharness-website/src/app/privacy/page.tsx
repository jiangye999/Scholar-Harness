import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">隐私政策</h1>
        <p className="text-gray-600 mb-8">生效日期：2026年5月16日　版本：V1.3</p>

        <div className="prose prose-blue max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. 重要提示</h2>
            <p className="text-gray-700 mb-4">
              Scholar Harness 是面向学术论文写作场景的辅助工具。我们会按照合法、正当、必要、诚信的原则处理您的个人信息，并尽量只收集实现服务所必需的信息。
            </p>
            <p className="text-gray-700">
              如果您不同意本政策的任何内容，请停止注册或使用本服务。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. 我们收集的信息</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>账号信息：电子邮箱、密码、用户名、验证码、登录状态与令牌。</li>
              <li>注册资格信息：注册时填写的内测码及其校验结果。</li>
              <li>服务使用与配置数据：权益状态、模型配置、功能开关、必要的服务运行记录。</li>
              <li>用户内容数据：上传文献、研究材料、实验资料、对话内容、章节规划、引用信息和草稿内容默认保存在您的本地设备中，我们不会保存到云端服务器。</li>
              <li>设备信息：我们不主动采集浏览器类型、操作系统等设备画像信息，也不将设备信息用于用户画像或商业分析。</li>
            </ul>
            <p className="text-gray-700 mt-4">
              当您使用 AI 写作、总结、解析、润色、引用辅助等功能时，相关用户内容可能会按照您的配置或明确选择，发送给您配置的 API 服务商进行处理。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. 信息使用目的</h2>
            <p className="text-gray-700 mb-4">我们会将收集的信息用于：</p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>创建、验证和管理用户账户；</li>
              <li>校验内测码、订阅状态和可用权益；</li>
              <li>在本地提供文献管理、材料总结、论文草稿生成、引用辅助和格式整理功能；</li>
              <li>在本地保存必要的写作进度、草稿和会话状态；</li>
              <li>按照您的配置或明确选择，调用您配置的 AI 模型、PDF 解析、OCR 等服务；</li>
              <li>处理故障排查、客服沟通、安全审计和异常行为防护。</li>
            </ul>
            <p className="text-gray-700 mt-4">
              我们不会将您的论文、研究材料、上传文献或写作内容保存到我们的云端服务器，不会出售给第三方，也不会用于训练公开通用 AI 模型。相关内容仅保存在您的本地设备，或在您使用相应功能时发送给您配置的 API 服务商处理。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. 信息存储</h2>
            <p className="text-gray-700 mb-4">
              桌面客户端运行时，部分会话、草稿、文献库索引、上传材料解析结果和本地配置会保存在您的本机应用数据目录中。卸载软件不一定会自动删除所有本地数据。
            </p>
            <p className="text-gray-700">
              如您使用账号、订阅、验证码、内测码或其他在线账户服务，相关账户信息、权益状态、支付或订阅记录、必要安全记录可能存储在服务器中。云端存储不包括您的上传文献、研究材料、论文草稿、对话内容或 AI 生成内容。
            </p>
          </section>

          <section className="mb-8" id="cross-border">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. 第三方服务与跨境传输</h2>
            <p className="text-gray-700 mb-4">
              当您使用 AI 写作、总结、翻译、润色、引用辅助、PDF 解析或 OCR 等功能时，您的输入内容、上下文片段、检索结果或必要文献摘要可能会发送给您配置或明确选择的第三方服务商进行处理。
            </p>
            <p className="text-gray-700">
              如果您配置或明确选择的 AI 服务商、模型接口、文件解析服务或基础设施位于中国境外，您的输入内容、写作上下文或文献片段可能会传输至境外服务器。您可以选择不勾选跨境传输同意项，或改用境内可用的服务配置。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. 信息安全</h2>
            <p className="text-gray-700 mb-4">
              我们会采取合理措施保护您的信息安全，包括 HTTPS 加密传输、密码保护性处理、后台权限限制、必要账户安全记录和异常行为防护。
            </p>
            <p className="text-gray-700">
              互联网环境和本地设备环境均无法保证绝对安全。请您妥善保管账户密码、API Key、研究材料和本地草稿，不要在不可信设备上登录或处理敏感内容。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. 您的权利</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>查询、更正或补充您的账户信息；</li>
              <li>删除您主动上传或生成的部分数据；</li>
              <li>注销账户；</li>
              <li>撤回已经作出的部分授权或同意；</li>
              <li>获取个人信息处理规则说明；</li>
              <li>对个人信息处理提出意见、投诉或举报。</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. 未成年人保护</h2>
            <p className="text-gray-700">
              本服务主要面向具有独立学术研究和写作能力的成年用户。未满 18 周岁的用户应在监护人同意和指导下使用本服务。我们不主动面向未满 14 周岁的儿童提供服务。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. 政策更新</h2>
            <p className="text-gray-700">
              我们可能因法律法规变化、产品功能调整或服务模式变化更新本隐私政策。重大变更会通过官网、应用内提示、邮件或其他合理方式通知您。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">10. 联系我们</h2>
            <p className="text-gray-700">
              如有隐私或数据安全问题，请联系：
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
