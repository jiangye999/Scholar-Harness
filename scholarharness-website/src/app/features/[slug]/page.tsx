import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeatureIcon } from "@/components/feature-icon";
import { getProductFeature, productFeatures } from "@/lib/product-features";

export const dynamicParams = false;

export function generateStaticParams() {
  return productFeatures.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const feature = getProductFeature(slug);

  if (!feature) {
    return {
      title: "功能介绍 - Scholar Harness",
    };
  }

  return {
    title: `${feature.title} - Scholar Harness 功能介绍`,
    description: feature.summary,
    alternates: {
      canonical: `https://scholarharness.com/features/${feature.slug}/`,
    },
  };
}

export default async function FeatureDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const feature = getProductFeature(slug);

  if (!feature) notFound();

  const relatedFeatures = productFeatures.filter((item) => item.slug !== feature.slug).slice(0, 3);

  return (
    <main className="min-h-screen bg-[#050706] text-[#f4f7f2]">
      <header className="border-b border-white/10 bg-[#0b100d]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="返回 Scholar Harness 首页">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#159a82] text-base font-semibold text-white">
              S
            </span>
            <span className="brand-roman text-lg font-semibold text-[#f4f7f2]">Scholar Harness</span>
          </Link>
          <Link
            href="/#features"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-[#0b100d] px-3 text-sm font-semibold text-[#dbe4df] transition hover:border-[#5ee0c4]/45 hover:text-[#5ee0c4]"
          >
            返回功能总览
            <FeatureIcon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="px-5 py-14 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#5ee0c4]/25 bg-[#0b100d] px-3 py-2 text-sm font-semibold text-[#5ee0c4]">
              <FeatureIcon name={feature.icon} className="h-4 w-4" />
              {feature.kicker}
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-[#f4f7f2] sm:text-5xl">
              {feature.title}
            </h1>
            <p className="mt-5 max-w-2xl text-xl leading-8 text-[#c9d4ce]">{feature.headline}</p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#a7b4ad]">{feature.summary}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#159a82] px-4 text-sm font-semibold text-white transition hover:bg-[#1fb99d]"
              >
                申请内测
                <FeatureIcon name="arrow" className="h-4 w-4" />
              </Link>
              <Link
                href="/#access"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#0b100d] px-4 text-sm font-semibold text-[#e9f1ec] transition hover:border-[#5ee0c4]/45 hover:text-[#5ee0c4]"
              >
                下载桌面端
                <FeatureIcon name="download" className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <aside className="rounded-lg border border-white/10 bg-[#111813] p-5 text-white shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <p className="text-sm font-semibold text-[#72e1c9]">功能链路</p>
                <h2 className="mt-2 text-2xl font-semibold">从输入到输出</h2>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#72e1c9]">
                <FeatureIcon name={feature.icon} className="h-6 w-6" />
              </div>
            </div>
            <ol className="mt-6 grid gap-4">
              {feature.workflow.map((step, index) => (
                <li key={step} className="grid grid-cols-[2.4rem_1fr] gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-[#72e1c9]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="pt-1.5 text-sm leading-6 text-[#dce8e1]">{step}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <div className="mx-auto mt-10 grid max-w-7xl gap-4 md:grid-cols-3">
          {feature.highlights.map((item) => (
            <div key={item} className="rounded-lg border border-[#26332d] bg-[#0b100d] p-5">
              <FeatureIcon name="check" className="h-5 w-5 text-[#5ee0c4]" />
              <div className="mt-4 text-sm font-semibold leading-6 text-[#dbe4df]">{item}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b100d] px-5 py-14 sm:px-6 lg:py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.58fr_1.42fr]">
          <div>
            <p className="text-sm font-semibold text-[#5ee0c4]">核心能力</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#f4f7f2]">
              这个模块具体做什么
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#a7b4ad]">
              功能页只展示用户需要判断的关键信息：它处理什么资料，做哪些步骤，最后能进入哪一段论文工作流。
            </p>
          </div>

          <div className="grid gap-4">
            {feature.detailSections.map((section) => (
              <article key={section.title} className="rounded-lg border border-white/10 bg-[#0b100d] p-6">
                <div className="grid gap-6 md:grid-cols-[0.48fr_1fr]">
                  <div>
                    <h3 className="text-2xl font-semibold text-[#f4f7f2]">{section.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-[#a7b4ad]">{section.body}</p>
                  </div>
                  <ul className="grid gap-3 text-sm text-[#c4cec8]">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-3 rounded-lg border border-[#26332d] bg-[#0b100d] p-3">
                        <FeatureIcon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#5ee0c4]" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.58fr_1.42fr]">
          <div>
            <p className="text-sm font-semibold text-[#5ee0c4]">输出物</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#f4f7f2]">
              结果可以继续被写作调用
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#a7b4ad]">
              输出结果会沉淀成项目上下文、表格、图件或草稿，减少重复上传和重复解释。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {feature.outputs.map((item, index) => (
              <div key={item} className="rounded-lg border border-white/10 bg-[#0b100d] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <FeatureIcon name="check" className="h-5 w-5 text-[#5ee0c4]" />
                  <span className="text-xs font-semibold text-[#66736b]">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="mt-5 text-sm font-semibold leading-6 text-[#dbe4df]">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#07100c] px-5 py-14 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold text-[#5ee0c4]">相关功能</p>
              <h2 className="mt-3 text-3xl font-semibold text-[#f4f7f2]">继续查看其他模块</h2>
            </div>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0b100d] px-4 text-sm font-semibold text-[#e9f1ec] transition hover:text-[#5ee0c4]"
            >
              回到首页
              <FeatureIcon name="arrow" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {relatedFeatures.map((item) => (
              <Link
                key={item.slug}
                href={`/features/${item.slug}`}
                className="rounded-lg border border-white/10 bg-[#0b100d] p-5 transition hover:-translate-y-0.5 hover:border-[#5ee0c4]/45 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#111813] text-[#5ee0c4]">
                  <FeatureIcon name={item.icon} className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#f4f7f2]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#a7b4ad]">{item.summary}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}


