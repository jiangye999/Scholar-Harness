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
    <main className="min-h-screen bg-[#f7f8f5] text-[#151815]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="返回 Scholar Harness 首页">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b6b5c] text-base font-semibold text-white">
              S
            </span>
            <span className="brand-roman text-lg font-semibold text-[#111411]">Scholar Harness</span>
          </Link>
          <Link
            href="/#features"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-semibold text-[#26312a] transition hover:border-black/25"
          >
            返回功能总览
            <FeatureIcon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="px-5 py-16 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#0b6b5c]/18 bg-white px-3 py-2 text-sm font-semibold text-[#0b6b5c]">
              <FeatureIcon name={feature.icon} className="h-4 w-4" />
              {feature.kicker}
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-tight text-[#101410] sm:text-5xl">
              {feature.title}
            </h1>
            <p className="mt-5 text-xl leading-8 text-[#465149]">{feature.headline}</p>
            <p className="mt-5 text-base leading-7 text-[#5d675f]">{feature.summary}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0b6b5c] px-4 text-sm font-semibold text-white transition hover:bg-[#084f45]"
              >
                申请内测
                <FeatureIcon name="arrow" className="h-4 w-4" />
              </Link>
              <Link
                href="/#features"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-black/15 bg-white px-4 text-sm font-semibold text-[#19221c] transition hover:border-black/30"
              >
                查看全部功能
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid gap-4 md:grid-cols-3">
              {feature.highlights.map((item) => (
                <div key={item} className="rounded-lg border border-[#d5dfd8] bg-[#f8faf8] p-4">
                  <FeatureIcon name="check" className="h-5 w-5 text-[#0b6b5c]" />
                  <div className="mt-4 text-sm font-semibold leading-6 text-[#26312a]">{item}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg bg-[#111813] p-5 text-white">
              <p className="text-sm font-semibold text-[#79d5c2]">典型流程</p>
              <ol className="mt-5 grid gap-4">
                {feature.workflow.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-[#79d5c2]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="pt-0.5 text-sm leading-6 text-[#dce8e1]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white px-5 py-16 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-2">
            {feature.detailSections.map((section) => (
              <article key={section.title} className="rounded-lg border border-black/10 bg-[#fbfcfb] p-6">
                <h2 className="text-2xl font-semibold text-[#101410]">{section.title}</h2>
                <p className="mt-4 text-sm leading-7 text-[#5d675f]">{section.body}</p>
                <ul className="mt-6 grid gap-3 text-sm text-[#3c463f]">
                  {section.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <FeatureIcon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#0b6b5c]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-semibold text-[#0b6b5c]">输出物</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#101410]">
              最终结果能继续进入论文写作流程
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#5d675f]">
              每个功能都会把结果沉淀成后续可调用的上下文、表格、图件或草稿，减少重复上传和重复解释。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {feature.outputs.map((item) => (
              <div key={item} className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
                <FeatureIcon name="check" className="h-5 w-5 text-[#0b6b5c]" />
                <div className="mt-4 text-sm font-semibold text-[#26312a]">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#e3eee9] px-5 py-14 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold text-[#0b6b5c]">相关功能</p>
              <h2 className="mt-3 text-3xl font-semibold text-[#101410]">继续查看其他模块</h2>
            </div>
            <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[#19221c]">
              回到首页
              <FeatureIcon name="arrow" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {relatedFeatures.map((item) => (
              <Link
                key={item.slug}
                href={`/features/${item.slug}`}
                className="rounded-lg border border-black/10 bg-white p-5 transition hover:border-[#0b6b5c]/45 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4f1] text-[#0b6b5c]">
                  <FeatureIcon name={item.icon} className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#151815]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5d675f]">{item.summary}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
