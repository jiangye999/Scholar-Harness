import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">关于 ScholarHarness</h1>
          <p className="text-gray-600 text-lg">让AI成为您的学术写作伙伴</p>
        </div>

        {/* Mission */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">我们的使命</h2>
          <p className="text-gray-700 leading-relaxed mb-4">
            ScholarHarness 致力于通过AI技术赋能学术研究，帮助研究者更高效地完成论文写作。
            我们相信，AI应该是研究者的得力助手，而非替代者。通过两级AI协作系统，
            我们确保写作过程既高效又保持学术诚信。
          </p>
          <p className="text-gray-700 leading-relaxed">
            我们的核心理念是"你是专家，AI是助手"。ScholarHarness不会替您写论文，
            而是提供专业的写作指导和文献支持，让您的研究成果以最佳方式呈现。
          </p>
        </section>

        {/* Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">核心特色</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-blue-50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
                  1
                </div>
                <h3 className="text-lg font-semibold text-gray-900">两级AI协作</h3>
              </div>
              <p className="text-gray-700 text-sm">
                Primary Agent负责规划与质控，Secondary Agent执行具体写作任务，分工明确，协同高效。
              </p>
            </div>

            <div className="bg-purple-50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center text-white font-bold">
                  2
                </div>
                <h3 className="text-lg font-semibold text-gray-900">期刊风格提取</h3>
              </div>
              <p className="text-gray-700 text-sm">
                上传目标期刊范文，自动提取8维度写作风格，确保论文符合期刊要求。
              </p>
            </div>

            <div className="bg-green-50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center text-white font-bold">
                  3
                </div>
                <h3 className="text-lg font-semibold text-gray-900">句子级文献检索</h3>
              </div>
              <p className="text-gray-700 text-sm">
                精确到摘要中每个句子的检索，所有引用100%真实，绝无虚构内容。
              </p>
            </div>

            <div className="bg-orange-50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center text-white font-bold">
                  4
                </div>
                <h3 className="text-lg font-semibold text-gray-900">多模型支持</h3>
              </div>
              <p className="text-gray-700 text-sm">
                支持GPT-4、Claude、通义千问等主流模型，灵活选择，按需使用。
              </p>
            </div>
          </div>
        </section>

        {/* Team */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">开发团队</h2>
          <p className="text-gray-700 leading-relaxed mb-4">
            ScholarHarness由一支热爱学术研究的技术团队开发。我们深知研究者的痛点，
            因此打造了这款真正符合学术写作需求的工具。
          </p>
          <p className="text-gray-700 leading-relaxed">
            团队成员来自中国农业大学，具有丰富的AI应用开发和学术研究经验。
            我们将持续优化产品，为学术界提供更好的服务。
          </p>
        </section>

        {/* Open Source */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">开源精神</h2>
          <p className="text-gray-700 leading-relaxed mb-4">
            ScholarHarness 是一个开源项目，我们相信开源的力量。任何人都可以查看、使用和改进我们的代码。
          </p>
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">GitHub 仓库</h3>
                <p className="text-gray-600 text-sm">查看源代码，参与贡献</p>
              </div>
              <a
                href="https://github.com/scholarharness"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium transition"
              >
                访问 GitHub
              </a>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">联系我们</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">邮箱</h3>
                <a href="mailto:sjs@cau.edu.cn" className="text-blue-600 hover:text-blue-700">
                  sjs@cau.edu.cn
                </a>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">GitHub</h3>
                <a
                  href="https://github.com/scholarharness"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700"
                >
                  github.com/scholarharness
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="bg-blue-600 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">开始使用 ScholarHarness</h2>
          <p className="text-blue-100 mb-6">体验AI辅助学术写作的高效与便捷</p>
          <div className="flex justify-center gap-4">
            <Link
              href="/register"
              className="px-8 py-3 bg-white text-blue-600 hover:bg-gray-100 rounded-lg font-medium transition"
            >
              免费注册
            </Link>
            <Link
              href="/help"
              className="px-8 py-3 border-2 border-white text-white hover:bg-white/10 rounded-lg font-medium transition"
            >
              了解更多
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}