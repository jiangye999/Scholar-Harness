"use client";

import { useState } from "react";
import Link from "next/link";
import { FeatureIcon } from "@/components/feature-icon";

const faqs = [
  {
    question: "Scholar Harness 是什么？",
    answer:
      "Scholar Harness 是面向论文全流程的 AI 学术工作台，覆盖 Auto Research、综述写作、讨论式写作、文献管理、文献计量、Meta 分析、数据分析和 R 语言作图。",
  },
  {
    question: "第一次使用应该先做什么？",
    answer:
      "建议先下载安装桌面端，登录账号后进入配置页面，依次完成小牛马、大牛马、Embedding、PDF 解析和联网搜索配置，再导入本地科研项目资料。",
  },
  {
    question: "支持哪些 AI 模型？",
    answer:
      "软件支持兼容 OpenAI API 格式的模型服务，也支持通义千问、DeepSeek 等常见服务商。具体可用模型取决于用户在桌面端配置的 API 地址、Key 和模型名称。",
  },
  {
    question: "桌面端和官网是什么关系？",
    answer:
      "官网负责注册、登录、下载和帮助说明；桌面端负责本地文献、PDF、Meta 数据、R 环境和长期项目工作流。两端使用同一账号体系。",
  },
  {
    question: "文献引用如何追溯？",
    answer:
      "写作和检索功能会优先使用项目内文献库、PDF 句子级论点库和结构化分析结果。用户仍需要在投稿前复核引用是否直接支持当前句子。",
  },
  {
    question: "为什么有些 PDF 下载不到？",
    answer:
      "软件优先走开放获取路径，例如 DOI 元数据、Unpaywall、Crossref、PubMed Central 和出版商开放链接。订阅墙、机构权限或登录验证码限制的 PDF 可能无法自动下载。",
  },
  {
    question: "Mac 安装包打不开怎么办？",
    answer:
      "当前 Mac 包未做 Apple 签名和 notarization 时，系统可能提示无法验证开发者。可以在系统设置的隐私与安全性里手动允许，或者使用已签名版本。",
  },
  {
    question: "如何获取技术支持？",
    answer: "可以通过邮箱 sjs@cau.edu.cn 联系支持，并附上软件版本、操作步骤、报错截图和相关日志。",
  },
];

const manualPdfHref = "/downloads/scholarharness-user-manual.pdf";
const manualHtmlHref = "/downloads/scholarharness-user-manual.html";

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

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
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-[#0b100d] px-3 text-sm font-semibold text-[#dbe4df] transition hover:border-[#5ee0c4]/45 hover:text-[#5ee0c4]"
          >
            回到首页
            <FeatureIcon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="px-5 py-14 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-end">
          <div>
            <p className="text-sm font-semibold text-[#5ee0c4]">帮助中心</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-[#f4f7f2] sm:text-5xl">
              安装、账号和基础使用入口
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#a7b4ad]">
              这里集中放置桌面端安装、配置顺序、手册下载、常见问题和支持入口，避免用户在官网、桌面端和本地文件之间来回找说明。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <a
              href="#guide"
              className="group rounded-lg border border-[#26332d] bg-[#0b100d] p-5 transition hover:border-[#5ee0c4] hover:shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#111813] text-[#5ee0c4]">
                <FeatureIcon name="book" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-[#f4f7f2]">使用手册</h2>
              <p className="mt-2 text-sm leading-6 text-[#a7b4ad]">下载 PDF 或在线查看。</p>
            </a>
            <a
              href="#faq"
              className="group rounded-lg border border-[#26332d] bg-[#0b100d] p-5 transition hover:border-[#5ee0c4] hover:shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#111813] text-[#5ee0c4]">
                <FeatureIcon name="question" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-[#f4f7f2]">常见问题</h2>
              <p className="mt-2 text-sm leading-6 text-[#a7b4ad]">快速排查使用问题。</p>
            </a>
            <Link
              href="/contact"
              className="group rounded-lg border border-[#26332d] bg-[#0b100d] p-5 transition hover:border-[#5ee0c4] hover:shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#111813] text-[#5ee0c4]">
                <FeatureIcon name="mail" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-[#f4f7f2]">联系我们</h2>
              <p className="mt-2 text-sm leading-6 text-[#a7b4ad]">提交问题和日志。</p>
            </Link>
          </div>
        </div>
      </section>

      <section id="guide" className="scroll-mt-24 border-y border-white/10 bg-[#0b100d] px-5 py-14 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="text-sm font-semibold text-[#5ee0c4]">使用指南</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#f4f7f2]">先完成安装和基础配置</h2>
            <p className="mt-4 text-sm leading-7 text-[#a7b4ad]">
              手册包含从下载安装到账号登录、API 配置、文件导入和各功能入口的完整流程。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <a
              href={manualPdfHref}
              download
              className="rounded-lg border border-[#26332d] bg-[#0c110e] p-6 transition hover:border-[#5ee0c4] hover:shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0b100d] text-[#5ee0c4]">
                <FeatureIcon name="download" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-[#f4f7f2]">下载使用手册 PDF</h3>
              <p className="mt-3 text-sm leading-6 text-[#a7b4ad]">适合保存到本地，按步骤完成桌面端配置。</p>
            </a>
            <a
              href={manualHtmlHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[#26332d] bg-[#0c110e] p-6 transition hover:border-[#5ee0c4] hover:shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0b100d] text-[#5ee0c4]">
                <FeatureIcon name="book" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-[#f4f7f2]">在线查看手册</h3>
              <p className="mt-3 text-sm leading-6 text-[#a7b4ad]">不下载文件，直接在浏览器里查看完整说明。</p>
            </a>
          </div>

          <ol className="lg:col-start-2 grid gap-3 text-sm leading-6 text-[#c4cec8]">
            {[
              "下载并安装对应系统的桌面端软件。",
              "注册或登录账号，按页面提示完成内测码或订阅激活。",
              "在配置页面依次完成小牛马、大牛马、Embedding、PDF Wiki/Marker 和联网搜索配置。",
              "导入 PDF、文献计量数据、Meta 编码表或实验数据后进入对应功能。",
            ].map((step, index) => (
              <li key={step} className="flex gap-3 rounded-lg border border-white/10 bg-[#0b100d] p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#159a82] text-xs font-semibold text-white">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 px-5 py-14 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="text-sm font-semibold text-[#5ee0c4]">常见问题</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#f4f7f2]">先看这些高频问题</h2>
            <p className="mt-4 text-sm leading-7 text-[#a7b4ad]">
              这里保留最影响安装、配置和正式使用的说明。复杂问题建议带日志联系支持。
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0b100d] shadow-sm">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              return (
                <div key={faq.question} className="border-b border-white/10 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-5 px-5 py-4 text-left transition hover:bg-[#0c110e]"
                  >
                    <span className="text-sm font-semibold text-[#f4f7f2]">{faq.question}</span>
                    <FeatureIcon
                      name="arrow"
                      className={`h-4 w-4 shrink-0 text-[#5ee0c4] transition ${isOpen ? "rotate-90" : ""}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5">
                      <p className="rounded-lg bg-[#050706] p-4 text-sm leading-7 text-[#a7b4ad]">{faq.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#111813] px-5 py-12 text-white sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold text-[#72e1c9]">需要人工支持</p>
            <h2 className="mt-2 text-2xl font-semibold">把问题、截图和日志一起发给我们</h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/contact"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0b100d] px-4 text-sm font-semibold text-[#111813] transition hover:bg-[#111813]"
            >
              联系我们
              <FeatureIcon name="arrow" className="h-4 w-4" />
            </Link>
            <a
              href="mailto:sjs@cau.edu.cn"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/45"
            >
              发送邮件
              <FeatureIcon name="mail" className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}


