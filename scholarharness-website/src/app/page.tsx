"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FeatureIcon } from "@/components/feature-icon";
import { productFeatures } from "@/lib/product-features";
import { getStoredUser, isAuthenticated, logout } from "@/lib/auth";
import type { User } from "@/lib/auth";

const navItems = [
  { label: "功能总览", href: "#features" },
  { label: "全流程能力", href: "#workflow" },
  { label: "适合场景", href: "#scenarios" },
  { label: "下载安装", href: "#access" },
];

const softwareDownloadHref = "/downloads/scholar-harness-setup-1.0.2.exe";
const manualDownloadHref = "/downloads/scholarharness-user-manual.pdf";

const workflowPillars = [
  {
    title: "资料进入系统",
    body: "文献 PDF、文献计量纯文本、Meta 编码表、实验数据和 Auto Research 调研结果都进入同一个项目上下文。",
  },
  {
    title: "AI 分析与配置",
    body: "用户选择变量、模型、效应量、文献计量参数或写作目标，系统只调用已经分析好的结构化结果。",
  },
  {
    title: "写作与图件输出",
    body: "讨论式写作、一键写综述、R 语言作图、Meta 分析图件和文献计量图件统一服务论文草稿。",
  },
];

const scenarioCards = [
  "系统综述和 Meta 分析团队",
  "需要文献计量图谱的研究者",
  "长期管理大量文献的课题组",
  "需要数据分析和 R 图件的论文作者",
];

interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>({ isLoggedIn: false, user: null });
  const router = useRouter();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const authenticated = isAuthenticated();
      setAuthState({
        isLoggedIn: authenticated,
        user: authenticated ? getStoredUser() : null,
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogout = () => {
    logout();
    setAuthState({ isLoggedIn: false, user: null });
    router.refresh();
  };

  const { isLoggedIn, user } = authState;
  const primaryCtaHref = isLoggedIn ? "/dashboard" : "/register";
  const primaryCtaLabel = isLoggedIn ? "进入控制台" : "申请内测";

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#151815]">
      <header className="fixed top-0 z-50 w-full border-b border-black/10 bg-[#f7f8f5]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="Scholar Harness 首页">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b6b5c] text-base font-semibold text-white shadow-sm">
              S
            </span>
            <span className="brand-roman text-lg font-semibold text-[#111411]">Scholar Harness</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm lg:flex" aria-label="主导航">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-[#58625b] transition hover:text-[#111411]">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard" className="hidden text-sm text-[#58625b] transition hover:text-[#111411] sm:block">
                  {user?.username || user?.email || "个人中心"}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="h-9 rounded-lg border border-black/10 px-3 text-sm font-medium text-[#2b332e] transition hover:border-black/20 hover:bg-white"
                >
                  登出
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm text-[#58625b] transition hover:text-[#111411]">
                  登录
                </Link>
                <Link
                  href="/register"
                  className="inline-flex h-9 items-center rounded-lg bg-[#0b6b5c] px-4 text-sm font-medium text-white transition hover:bg-[#084f45]"
                >
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="relative overflow-hidden pt-16">
          <div className="absolute inset-0" aria-hidden="true">
            <Image
              src="/scholarharness-workspace-hero.png"
              alt=""
              fill
              priority
              unoptimized
              sizes="100vw"
              className="object-cover object-center"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(247,248,245,0.98)_0%,rgba(247,248,245,0.94)_33%,rgba(247,248,245,0.52)_64%,rgba(247,248,245,0.2)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(247,248,245,0.1)_0%,rgba(247,248,245,0.18)_55%,rgba(247,248,245,0.96)_100%)]" />
          </div>

          <div className="relative z-20 mx-auto flex min-h-[78svh] max-w-7xl items-center px-5 py-12 sm:px-6 lg:py-16">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-[#0b6b5c]/20 bg-white/65 px-3 py-2 text-sm font-semibold text-[#0b6b5c]">
                <FeatureIcon name="spark" className="h-4 w-4" />
                面向论文全流程的 AI 学术工作台
              </div>
              <h1 className="brand-roman text-4xl font-semibold leading-[1.02] text-[#101410] sm:text-6xl lg:text-7xl">
                Scholar Harness
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#465149] sm:text-xl">
                把 Auto Research、综述写作、讨论式写作、文献计量、Meta 分析、文献管理、数据分析和 R 语言作图放进同一个科研项目流程。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="#features"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#0b6b5c] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#084f45]"
                >
                  查看功能
                  <FeatureIcon name="arrow" className="h-4 w-4" />
                </Link>
                <Link
                  href={primaryCtaHref}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-black/15 bg-white/80 px-5 text-sm font-semibold text-[#19221c] transition hover:border-black/30 hover:bg-white"
                >
                  {primaryCtaLabel}
                  <FeatureIcon name="arrow" className="h-4 w-4" />
                </Link>
                <a
                  href={softwareDownloadHref}
                  download
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#0b6b5c]/30 bg-white/90 px-5 text-sm font-semibold text-[#0b6b5c] transition hover:border-[#0b6b5c] hover:bg-white"
                >
                  下载软件
                  <FeatureIcon name="download" className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-[78px] max-w-5xl">
                <p className="mb-3 text-sm font-semibold text-[#0b6b5c]">七大核心功能</p>
                <div className="flex flex-nowrap gap-2.5 overflow-x-auto pb-1 lg:overflow-visible lg:pb-0">
                  {productFeatures.map((feature) => (
                    <Link
                      key={feature.slug}
                      href={`/features/${feature.slug}`}
                      className="inline-flex h-9 w-max shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#0b6b5c]/20 bg-white/78 px-3.5 text-xs font-semibold text-[#243129] shadow-sm backdrop-blur-sm transition hover:border-[#0b6b5c]/45 hover:bg-white hover:text-[#0b6b5c]"
                    >
                      <FeatureIcon name={feature.icon} className="h-3.5 w-3.5 shrink-0 text-[#0b6b5c]" />
                      <span>{feature.shortTitle}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="relative z-10 -mt-[200px] bg-[#f7f8f5] px-5 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <h2 className="text-3xl font-semibold leading-tight text-[#101410] sm:text-4xl">
                  每个功能都是独立模块，也能共同组成论文全流程
                </h2>
                <p className="text-sm leading-6 text-[#5d675f]">
                  点击任意功能进入详情页，查看它解决什么问题、怎么使用、能输出什么结果。
                </p>
              </div>
            </div>

            <div className="mt-10 grid gap-5">
              {productFeatures.map((feature, index) => (
                <Link
                  key={feature.slug}
                  href={`/features/${feature.slug}`}
                  className="group grid gap-6 rounded-lg border border-black/10 bg-white p-5 shadow-sm transition hover:border-[#0b6b5c]/45 hover:shadow-md md:grid-cols-[0.42fr_1fr] md:p-6"
                >
                  <div className="flex flex-col justify-between gap-6 rounded-lg bg-[#eef4f1] p-5">
                    <div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-[#0b6b5c] shadow-sm">
                        <FeatureIcon name={feature.icon} />
                      </div>
                      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#69736c]">
                        {String(index + 1).padStart(2, "0")} / {feature.kicker}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-[#101410]">{feature.title}</h3>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#0b6b5c]">
                      进入功能介绍
                      <FeatureIcon name="arrow" className="h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
                    <div>
                      <h4 className="text-xl font-semibold leading-snug text-[#151815]">{feature.headline}</h4>
                      <p className="mt-4 text-sm leading-7 text-[#5d675f]">{feature.homeIntro}</p>
                      <div className="mt-6 flex flex-wrap gap-2">
                        {feature.highlights.map((item) => (
                          <span key={item} className="rounded-lg border border-[#d5dfd8] bg-[#f8faf8] px-3 py-1 text-xs font-medium text-[#445047]">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-black/10 bg-[#fbfcfb] p-4">
                      <p className="text-xs font-semibold text-[#758078]">主要输出</p>
                      <ul className="mt-3 grid gap-2 text-sm text-[#3c463f]">
                        {feature.outputs.map((item) => (
                          <li key={item} className="flex gap-2">
                            <FeatureIcon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#0b6b5c]" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-[#111813] px-5 py-20 text-white sm:px-6 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
              <div>
                <p className="text-sm font-semibold text-[#79d5c2]">全流程能力</p>
                <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                  从资料、分析到写作，减少工具之间的断点
                </h2>
                <p className="mt-4 text-base leading-7 text-[#c7d2ca]">
                  服务器首页现在突出真实功能链路：用户不是只看“AI 写作”，而是能看见论文从调研、资料管理、统计分析到图文输出的完整路径。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {workflowPillars.map((item, index) => (
                  <article key={item.title} className="rounded-lg border border-white/12 bg-white/[0.04] p-5">
                    <div className="text-sm font-semibold text-[#79d5c2]">{String(index + 1).padStart(2, "0")}</div>
                    <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#c7d2ca]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="scenarios" className="px-5 py-20 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold text-[#0b6b5c]">适合场景</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#101410] sm:text-4xl">
                为真实科研项目准备，而不是只做演示型聊天
              </h2>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {scenarioCards.map((item) => (
                <article key={item} className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4f1] text-[#0b6b5c]">
                    <FeatureIcon name="check" className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-[#151815]">{item}</h3>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="access" className="border-y border-black/10 bg-white px-5 py-16 sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold text-[#0b6b5c]">下载安装</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#101410] sm:text-4xl">
                一套账号连接官网、桌面端和本地科研项目
              </h2>
              <p className="mt-4 text-base leading-7 text-[#5d675f]">
                官网负责注册、登录、说明和服务入口；桌面端负责本地文献、Meta 数据、R 语言环境和长期项目工作流。
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <a
                href={softwareDownloadHref}
                download
                className="rounded-lg border border-[#b8cbc3] bg-[#f8faf8] p-5 transition hover:border-[#0b6b5c] hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0b6b5c]">
                  <FeatureIcon name="download" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#151815]">下载 Windows 桌面端</h3>
                <p className="mt-3 text-sm leading-6 text-[#5d675f]">下载 Scholar Harness 安装包，适用于 Windows x64。</p>
                <p className="mt-3 text-xs font-semibold text-[#0b6b5c]">约 418 MB</p>
              </a>
              <a
                href={manualDownloadHref}
                download
                className="rounded-lg border border-[#b8cbc3] bg-[#f8faf8] p-5 transition hover:border-[#0b6b5c] hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0b6b5c]">
                  <FeatureIcon name="file" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#151815]">下载使用手册 PDF</h3>
                <p className="mt-3 text-sm leading-6 text-[#5d675f]">从配置、文件导入到各功能使用的完整指导手册。</p>
                <p className="mt-3 text-xs font-semibold text-[#0b6b5c]">PDF 版</p>
              </a>
              <Link
                href="/register"
                className="rounded-lg border border-[#b8cbc3] bg-[#f8faf8] p-5 transition hover:border-[#0b6b5c] hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0b6b5c]">
                  <FeatureIcon name="spark" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#151815]">注册与内测</h3>
                <p className="mt-3 text-sm leading-6 text-[#5d675f]">创建账号后进入控制台和桌面端使用流程。</p>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10 bg-white px-5 py-10 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b6b5c] text-base font-semibold text-white">
                S
              </span>
              <span className="brand-roman text-lg font-semibold text-[#111411]">Scholar Harness</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#5d675f]">
              面向科研论文全流程的 AI 学术工作台，覆盖调研、写作、文献管理、文献计量、Meta 分析、数据分析和 R 语言作图。
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-[#151815]">功能</h4>
            <ul className="mt-4 space-y-2 text-sm text-[#5d675f]">
              {productFeatures.slice(0, 4).map((feature) => (
                <li key={feature.slug}>
                  <Link href={`/features/${feature.slug}`} className="transition hover:text-[#111411]">
                    {feature.shortTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-[#151815]">账号与条款</h4>
            <ul className="mt-4 space-y-2 text-sm text-[#5d675f]">
              <li><Link href="/login" className="transition hover:text-[#111411]">登录</Link></li>
              <li><Link href="/register" className="transition hover:text-[#111411]">注册</Link></li>
              <li><Link href="/privacy" className="transition hover:text-[#111411]">隐私政策</Link></li>
              <li><Link href="/terms" className="transition hover:text-[#111411]">用户协议</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
