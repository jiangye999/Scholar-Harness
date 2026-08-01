"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FeatureIcon, type IconName } from "@/components/feature-icon";
import { productFeatures } from "@/lib/product-features";
import { getStoredUser, isAuthenticated, logout } from "@/lib/auth";
import type { User } from "@/lib/auth";

const navItems = [
  { label: "功能圆盘", href: "#features" },
  { label: "下载安装", href: "#hero-downloads" },
  { label: "帮助中心", href: "/help" },
];

const windowsDownloadHref = "/downloads/scholar-harness-setup-1.0.8.exe";
const macArm64DownloadHref = "https://github.com/jiangye999/Scholar-Harness/releases/download/v1.0.8/scholar-harness-1.0.8-arm64.dmg";
const macX64DownloadHref = "https://github.com/jiangye999/Scholar-Harness/releases/download/v1.0.8/scholar-harness-1.0.8-x64.dmg";
const manualDownloadHref = "/downloads/scholarharness-user-manual.pdf";
const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1").replace(/\/$/, "");

const featureVideos: Record<string, { src: string; title: string }> = {
  "auto-research": {
    src: "/videos/auto-research.mp4",
    title: "Auto Research 演示",
  },
  "review-writing": {
    src: "/videos/review-writing.mp4",
    title: "一键辅助写综述演示",
  },
  "discussion-writing": {
    src: "/videos/discussion-writing.mp4",
    title: "讨论式辅助写作演示",
  },
  bibliometrics: {
    src: "/videos/bibliometrics.mp4",
    title: "文献计量分析演示",
  },
  "meta-analysis": {
    src: "/videos/meta-analysis.mp4",
    title: "Meta 分析演示",
  },
  "ai-pdf-management": {
    src: "/videos/ai-pdf-management.mp4",
    title: "AI 文献管理演示",
  },
  "data-analysis-r-plot": {
    src: "/videos/data-analysis-r-plot.mp4",
    title: "数据分析 + R 作图演示",
  },
  "sentence-claim-search": {
    src: "/videos/ai-pdf-management.mp4",
    title: "PDF 句子级论点库演示",
  },
};

interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
}

interface DownloadStatsState {
  loaded: boolean;
  pageViewTotalCount: number | null;
  installerTotalCount: number | null;
  assetCounts: Record<string, number>;
}

interface OrbitItem {
  slug: string;
  title: string;
  shortTitle: string;
  kicker: string;
  icon: IconName;
  headline: string;
  homeIntro: string;
  highlights: string[];
  outputs: string[];
}

const orbitItems: OrbitItem[] = [
  ...productFeatures.map((feature) => ({
    slug: feature.slug,
    title: feature.title,
    shortTitle: feature.shortTitle,
    kicker: feature.kicker,
    icon: feature.icon,
    headline: feature.headline,
    homeIntro: feature.homeIntro,
    highlights: feature.highlights,
    outputs: feature.outputs,
  })),
  {
    slug: "sentence-claim-search",
    title: "句子级论点检索",
    shortTitle: "论点检索",
    kicker: "证据匹配与引用溯源",
    icon: "book",
    headline: "输入一句论文论点，快速匹配项目文献库中的支持、反对和相关证据。",
    homeIntro:
      "面向写作中的单句证据核查：先解析用户句子，再做关键词候选池和语义相似度重排，最后按支持关系展示可追溯来源。",
    highlights: ["句子级检索", "支持/反对/相关判断", "摘要折叠与翻译"],
    outputs: ["证据文献", "摘要与翻译", "支持关系", "可追溯引用线索"],
  },
];

const orbitTopPositions = [8, 20, 32, 44, 56, 68, 80, 92];

function getOrbitPosition(index: number) {
  const top = orbitTopPositions[index] ?? 50;
  const normalizedY = (top - 50) / 50;
  const normalizedX = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));

  return {
    left: `${50 + 50 * normalizedX}%`,
    top: `${top}%`,
  };
}

function formatDownloadCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>({ isLoggedIn: false, user: null });
  const [activeFeatureSlug, setActiveFeatureSlug] = useState<string | null>(null);
  const [downloadStats, setDownloadStats] = useState<DownloadStatsState>({
    loaded: false,
    pageViewTotalCount: null,
    installerTotalCount: null,
    assetCounts: {},
  });
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

  useEffect(() => {
    let cancelled = false;
    const trackPageView = () => {
      const storageKey = "scholarharness_home_page_view_tracked";
      try {
        if (window.sessionStorage.getItem(storageKey) === "1") return;
        window.sessionStorage.setItem(storageKey, "1");
      } catch {
        // 如果 sessionStorage 不可用，仍允许后端记录一次页面加载。
      }

      fetch(`${apiBaseUrl}/downloads/page-view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageKey: "home", path: window.location.pathname }),
        keepalive: true,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data?.success || !data.page) return;
          setDownloadStats((current) => ({
            ...current,
            pageViewTotalCount: Number(data.page.totalCount || 0),
          }));
        })
        .catch(() => {});
    };

    fetch(`${apiBaseUrl}/downloads/stats`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.assets)) return;
        const assetCounts: Record<string, number> = {};
        for (const asset of data.assets) {
          if (asset?.key) assetCounts[String(asset.key)] = Number(asset.totalCount || 0);
        }
        setDownloadStats({
          loaded: true,
          pageViewTotalCount: Number(data.pageViewTotalCount || data.pageViews?.totalCount || 0),
          installerTotalCount: Number(data.installerTotalCount || 0),
          assetCounts,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setDownloadStats((current) => ({ ...current, loaded: false }));
        }
      });

    trackPageView();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    logout();
    setAuthState({ isLoggedIn: false, user: null });
    router.refresh();
  };

  const trackDownload = (assetKey: string) => {
    const payload = JSON.stringify({ assetKey });
    const url = `${apiBaseUrl}/downloads/track`;

    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      return;
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  };

  const handleInstallerDownload = (assetKey: string) => {
    trackDownload(assetKey);
    trackDownload("manual");

    const manualLink = document.createElement("a");
    manualLink.href = manualDownloadHref;
    manualLink.download = "Scholar-Harness-使用指导手册-1.0.8.pdf";
    manualLink.style.display = "none";
    document.body.appendChild(manualLink);
    manualLink.click();
    manualLink.remove();
  };

  const { isLoggedIn, user } = authState;
  const primaryCtaHref = isLoggedIn ? "/dashboard" : "/register";
  const primaryCtaLabel = isLoggedIn ? "进入控制台" : "申请内测";
  const activeFeature = orbitItems.find((item) => item.slug === activeFeatureSlug) || null;
  const activeVideo = activeFeature ? featureVideos[activeFeature.slug] : null;
  const installerDownloadText = downloadStats.loaded && downloadStats.installerTotalCount !== null
    ? formatDownloadCount(downloadStats.installerTotalCount)
    : "";
  const pageViewText = downloadStats.pageViewTotalCount !== null
    ? formatDownloadCount(downloadStats.pageViewTotalCount)
    : "";

  return (
    <div className="min-h-screen scroll-smooth bg-[#050706] text-[#f4f7f2]">
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#050706]/88 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="Scholar Harness 首页">
            <span className="brand-roman text-lg font-semibold text-[#f4f7f2]">Scholar Harness</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm lg:flex" aria-label="主导航">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-[#9faaa4] transition hover:text-[#f4f7f2]">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard" className="hidden text-sm text-[#9faaa4] transition hover:text-[#f4f7f2] sm:block">
                  {user?.username || user?.email || "个人中心"}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="h-9 rounded-lg border border-white/10 px-3 text-sm font-medium text-[#dbe4df] transition hover:border-white/25 hover:bg-[#111813]"
                >
                  登出
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm text-[#9faaa4] transition hover:text-[#f4f7f2]">
                  登录
                </Link>
                <Link
                  href="/register"
                  className="inline-flex h-9 items-center rounded-lg bg-[#159a82] px-4 text-sm font-medium text-white transition hover:bg-[#1fb99d]"
                >
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content">
        <section id="hero" className="relative min-h-[100svh] overflow-hidden pt-16">
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
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,6,0.99)_0%,rgba(5,7,6,0.92)_34%,rgba(5,7,6,0.58)_67%,rgba(5,7,6,0.28)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_36%,rgba(94,224,196,0.16),transparent_32%),linear-gradient(180deg,rgba(5,7,6,0.04)_0%,rgba(5,7,6,0.24)_58%,rgba(5,7,6,0.98)_100%)]" />
          </div>

          <div className="relative z-20 mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl items-center px-5 pb-24 pt-12 sm:px-6 lg:pt-16">
            <div className="max-w-6xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-lg border border-[#5ee0c4]/30 bg-[#0b100d]/78 px-4 py-2.5 text-sm font-semibold text-[#5ee0c4] shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
                <FeatureIcon name="spark" className="h-4 w-4" />
                面向论文全流程的 AI 学术工作台
              </div>
              <h1 className="brand-roman max-w-4xl text-6xl font-semibold leading-[0.96] text-[#f4f7f2] sm:text-7xl lg:text-8xl">
                Scholar Harness
              </h1>
              <div className="mt-8 max-w-6xl space-y-4 text-lg leading-8 text-[#d3ddd7] sm:text-xl sm:leading-9 xl:text-2xl xl:leading-10">
                <p className="whitespace-nowrap">
                  集数据自动分析， R 语言一键作图，讨论式辅助写作，meta分析数据提取、分析、作图和写作于一体的科研服务平台。
                </p>
                <p className="whitespace-nowrap">
                  更有Auto Research、综述写作、Ai文献管理、句子级论点查询等实用功能！
                </p>
              </div>
              <div id="hero-downloads" className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href="#features"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg bg-[#159a82] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1fb99d]"
                >
                  查看功能
                  <FeatureIcon name="arrow" className="h-4 w-4" />
                </Link>
                <Link
                  href={primaryCtaHref}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#0b100d]/86 px-5 py-3 text-sm font-semibold text-[#e9f1ec] transition hover:border-white/30 hover:bg-[#111813]"
                >
                  {primaryCtaLabel}
                  <FeatureIcon name="arrow" className="h-4 w-4" />
                </Link>
                <a
                  href={manualDownloadHref}
                  download
                  onClick={() => trackDownload("manual")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-[#5ee0c4]/35 bg-[#0b100d]/90 px-5 py-3 text-sm font-semibold text-[#5ee0c4] transition hover:border-[#5ee0c4] hover:bg-[#111813]"
                >
                  使用说明
                  <FeatureIcon name="file" className="h-4 w-4" />
                </a>
                <a
                  href={windowsDownloadHref}
                  download
                  onClick={() => handleInstallerDownload("windows")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-[#5ee0c4]/35 bg-[#0b100d]/90 px-5 py-3 text-sm font-semibold text-[#5ee0c4] transition hover:border-[#5ee0c4] hover:bg-[#111813]"
                >
                  Windows + 使用说明
                  <FeatureIcon name="windows" className="h-4 w-4" />
                </a>
                <a
                  href={macArm64DownloadHref}
                  download
                  onClick={() => handleInstallerDownload("mac-arm64")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-[#5ee0c4]/35 bg-[#0b100d]/90 px-5 py-3 text-sm font-semibold text-[#5ee0c4] transition hover:border-[#5ee0c4] hover:bg-[#111813]"
                >
                  Mac M 系列 + 使用说明
                  <FeatureIcon name="apple" className="h-4 w-4" />
                </a>
                <a
                  href={macX64DownloadHref}
                  download
                  onClick={() => handleInstallerDownload("mac-x64")}
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-[#5ee0c4]/35 bg-[#0b100d]/90 px-5 py-3 text-sm font-semibold text-[#5ee0c4] transition hover:border-[#5ee0c4] hover:bg-[#111813]"
                >
                  Mac Intel + 使用说明
                  <FeatureIcon name="apple" className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-3 text-xs text-[#9faaa4]">
                点击安装包会同时下载 PDF 使用说明；若浏览器拦截多个文件，可单独点击“使用说明”。
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium text-[#9faaa4]">
                <span className="rounded-lg border border-white/10 bg-[#0b100d]/78 px-3 py-2 text-[#dbe4df]">
                  网页浏览量 {pageViewText || "统计中"} 次
                </span>
                <span className="rounded-lg border border-white/10 bg-[#0b100d]/78 px-3 py-2 text-[#dbe4df]">
                  安装包累计下载 {installerDownloadText || "统计中"} 次
                </span>
                {downloadStats.loaded ? (
                  <>
                    <span className="rounded-lg border border-white/10 bg-[#0b100d]/62 px-3 py-2">
                      Windows {formatDownloadCount(downloadStats.assetCounts.windows ?? 0)}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#0b100d]/62 px-3 py-2">
                      Mac M {formatDownloadCount(downloadStats.assetCounts["mac-arm64"] ?? 0)}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#0b100d]/62 px-3 py-2">
                      Mac Intel {formatDownloadCount(downloadStats.assetCounts["mac-x64"] ?? 0)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <a
            href="#features"
            className="absolute bottom-6 left-1/2 z-30 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs font-semibold text-[#9faaa4] transition hover:text-[#5ee0c4] md:flex"
          >
            <span>向下滑动查看功能圆盘</span>
            <span className="flex h-9 w-6 items-start justify-center rounded-full border border-white/20 p-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#5ee0c4]" />
            </span>
          </a>
        </section>

        <section
          id="features"
          className="relative min-h-[100svh] scroll-mt-16 overflow-hidden border-t border-white/10 bg-[#050706] px-5 py-10 sm:px-6 lg:flex lg:items-center lg:py-10"
          onMouseLeave={() => setActiveFeatureSlug(null)}
        >
          <div className="absolute inset-0" aria-hidden="true">
            <div className="absolute left-[-16rem] top-1/2 h-[66svh] min-h-[440px] w-[66svh] min-w-[440px] -translate-y-1/2 rounded-full border border-[#5ee0c4]/20 bg-[radial-gradient(circle_at_70%_50%,rgba(94,224,196,0.14),rgba(11,16,13,0.26)_45%,rgba(5,7,6,0)_72%)]" />
            <div className="absolute inset-y-0 right-0 w-[62vw] bg-[radial-gradient(circle_at_40%_50%,rgba(94,224,196,0.11),transparent_34%)]" />
          </div>

          <div className="pointer-events-auto absolute left-0 top-1/2 z-20 hidden h-[66svh] min-h-[440px] w-[66svh] min-w-[440px] -translate-x-1/2 -translate-y-1/2 lg:block">
            <div className="absolute inset-0 rounded-full border border-[#5ee0c4]/25 shadow-[0_0_90px_rgba(94,224,196,0.08)]" />
            <div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute left-[67%] top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="text-xs font-semibold text-[#5ee0c4]/70">Scholar Harness</div>
              <div className="mt-2 whitespace-nowrap text-3xl font-semibold leading-none text-[#f4f7f2]">
                8大核心功能
              </div>
            </div>
            {orbitItems.map((item, index) => {
              const isActive = activeFeatureSlug === item.slug;
              return (
                <div
                  key={item.slug}
                  className="absolute -translate-x-7 -translate-y-1/2"
                  style={getOrbitPosition(index)}
                >
                  <button
                    type="button"
                    title={item.title}
                    aria-label={item.title}
                    onClick={() => setActiveFeatureSlug(item.slug)}
                    onMouseEnter={() => setActiveFeatureSlug(item.slug)}
                    onFocus={() => setActiveFeatureSlug(item.slug)}
                    className={`group flex h-14 min-w-[184px] items-center gap-3 rounded-full border py-1.5 pl-1.5 pr-4 text-left text-[#f4f7f2] shadow-[0_18px_40px_rgba(0,0,0,0.34)] transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#5ee0c4] ${
                      isActive
                        ? "scale-[1.04] border-[#5ee0c4] bg-[#159a82] text-white"
                        : "border-[#5ee0c4]/28 bg-[#0b100d] hover:scale-[1.02] hover:border-[#5ee0c4] hover:bg-[#111813] hover:text-[#5ee0c4]"
                    }`}
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                      isActive ? "border-white/20 bg-white/10" : "border-[#5ee0c4]/20 bg-[#050706] group-hover:border-[#5ee0c4]/45"
                    }`}>
                      <FeatureIcon name={item.icon} className="h-5 w-5" />
                    </span>
                    <span className="max-w-[112px] text-sm font-semibold leading-tight">{item.shortTitle}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-[96rem] gap-6 lg:grid-cols-[0.62fr_1.38fr] lg:items-center xl:gap-8">
            <div className="pointer-events-none hidden min-h-[64svh] lg:block" aria-hidden="true" />

            <div className="lg:hidden">
              <p className="text-sm font-semibold text-[#5ee0c4]">核心功能</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#f4f7f2]">
                选择一个功能查看介绍
              </h2>
              <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
                {orbitItems.map((item) => {
                  const isActive = activeFeatureSlug === item.slug;
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() => setActiveFeatureSlug(item.slug)}
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${
                        isActive
                          ? "border-[#5ee0c4] bg-[#159a82] text-white"
                          : "border-[#26332d] bg-[#0b100d] text-[#c4cec8]"
                      }`}
                    >
                      <FeatureIcon name={item.icon} className="h-4 w-4" />
                      {item.shortTitle}
                    </button>
                  );
                })}
              </div>
            </div>

            <article className="rounded-[1.5rem] border border-white/10 bg-[#0b100d]/92 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.36)] backdrop-blur-md sm:p-5 lg:max-h-[calc(100svh-6rem)] lg:overflow-hidden xl:-ml-20">
              {activeFeature ? (
                <div className="grid gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#5ee0c4]">{activeFeature.kicker}</p>
                    <h3 className="mt-2 text-3xl font-semibold leading-tight text-[#f4f7f2] sm:text-4xl">
                      {activeFeature.title}
                    </h3>
                  </div>

                  <div className="grid min-h-0 content-start gap-4">
                    <div className="rounded-2xl border border-white/10 bg-[#050706] p-4">
                      <p className="text-sm font-semibold leading-6 text-[#f4f7f2]">{activeFeature.headline}</p>
                      <p className="mt-2 text-sm leading-6 text-[#a7b4ad]">{activeFeature.homeIntro}</p>
                      <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-[#758078]">关键能力</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {activeFeature.highlights.map((item) => (
                              <span key={item} className="rounded-lg border border-[#26332d] bg-[#0c110e] px-2.5 py-1 text-xs font-medium text-[#c4cec8]">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#758078]">主要输出</p>
                          <ul className="mt-2 grid gap-1.5 text-sm text-[#c4cec8] sm:grid-cols-2">
                            {activeFeature.outputs.slice(0, 4).map((item) => (
                              <li key={item} className="flex gap-2">
                                <FeatureIcon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#5ee0c4]" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="self-start rounded-2xl border border-white/10 bg-black/45 p-2 xl:p-3">
                      {activeVideo ? (
                        <>
                          <p className="px-1 pb-2 text-xs font-semibold text-[#758078]">{activeVideo.title}</p>
                          <div className="flex items-center justify-center overflow-hidden">
                            <video
                              key={activeVideo.src}
                              className="aspect-video w-full max-h-[50svh] rounded-xl border border-white/10 bg-black object-contain"
                              autoPlay
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              controls
                            >
                              <source src={activeVideo.src} type="video/mp4" />
                            </video>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid h-full gap-4 lg:grid-rows-[auto_1fr]">
                  <div>
                    <p className="text-sm font-semibold text-[#5ee0c4]">项目总览</p>
                    <h3 className="mt-2 text-3xl font-semibold leading-tight text-[#f4f7f2] sm:text-4xl">
                      一个科研项目里完成调研、分析、作图和写作
                    </h3>
                  </div>

                  <div className="grid min-h-0 gap-4 xl:grid-cols-[0.62fr_1.38fr]">
                    <div className="rounded-2xl border border-white/10 bg-[#050706] p-4">
                      <p className="text-sm leading-6 text-[#a7b4ad]">
                        Scholar Harness 的核心不是单次聊天，而是把文献、数据、Meta 编码表、PDF 解析结果和写作上下文放在同一个本地项目中长期使用。
                      </p>
                      <p className="mt-4 text-xs font-semibold text-[#758078]">默认工作路径</p>
                      <div className="mt-4 grid gap-2.5">
                        {["导入资料", "结构化分析", "证据检索", "论文写作", "图表输出"].map((item, index) => (
                          <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0b100d] p-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#111813] text-xs font-semibold text-[#5ee0c4]">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="text-sm font-medium text-[#dbe4df]">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-black xl:min-h-[420px]">
                      <Image
                        src="/scholarharness-workspace-hero.png"
                        alt="Scholar Harness 工作台界面"
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 45vw, 100vw"
                        className="object-cover opacity-70"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,6,0.88),rgba(5,7,6,0.34))]" />
                      <div className="absolute bottom-5 left-5 right-5">
                        <p className="text-xs font-semibold text-[#5ee0c4]">本地科研项目工作台</p>
                        <p className="mt-2 max-w-md text-lg font-semibold leading-snug text-[#f4f7f2]">
                          资料、分析、证据和草稿在同一个项目里持续沉淀。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          </div>
        </section>
      </main>

    </div>
  );
}
