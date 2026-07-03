import type { Metadata, Viewport } from "next";
import { SiteFilingFooter } from "@/components/site-filing-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScholarHarness - AI 学术论文全流程工作台",
  description: "ScholarHarness 覆盖 Auto Research、一键辅助写综述、讨论式辅助写作、文献计量分析全流程、Meta 分析全流程、AI 化文献管理、一键数据分析和 R 语言作图。",
  keywords: ["论文写作", "学术研究", "AI写作助手", "文献计量", "Meta分析", "文献管理", "R语言作图", "综述写作"],
  
  // Open Graph
  openGraph: {
    title: "ScholarHarness - AI 学术论文全流程工作台",
    description: "覆盖 Auto Research、综述写作、讨论式写作、文献计量、Meta 分析、AI 化文献管理、数据分析和 R 语言作图。",
    url: "https://scholarharness.com",
    siteName: "ScholarHarness",
    locale: "zh_CN",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "ScholarHarness - 学术论文写作助手",
      },
    ],
  },
  
  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "ScholarHarness - AI 学术论文全流程工作台",
    description: "覆盖调研、写作、文献管理、文献计量、Meta 分析、数据分析和 R 语言作图。",
    images: ["/og-image.png"],
  },
  
  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  
  // Alternates
  alternates: {
    canonical: "https://scholarharness.com",
  },
  
  // Other metadata
  authors: [{ name: "ScholarHarness Team", url: "https://scholarharness.com" }],
  creator: "ScholarHarness",
  publisher: "ScholarHarness",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://scholarharness.com"),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 移除 maximumScale 和 userScalable 限制，符合 WCAG 可访问性标准
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* JSON-LD 结构化数据 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "ScholarHarness",
              "applicationCategory": "EducationalApplication",
              "operatingSystem": "Windows, macOS, Linux",
              "description": "对话式学术论文写作助手，基于两级AI协作系统",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "CNY",
                "description": "基础版永久免费",
              },
              "author": {
                "@type": "Organization",
                "name": "ScholarHarness Team",
                "email": "sjs@cau.edu.cn",
              },
              "featureList": [
                "Auto Research 自动调研",
                "一键辅助写综述",
                "讨论式辅助写作",
                "文献计量分析全流程",
                "Meta 分析全流程",
                "AI 化文献管理",
                "一键数据分析和 R 语言作图",
              ],
            }),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Skip Link - 跳过导航，符合 WCAG 可访问性标准 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-3 focus:py-2 focus:bg-[#159a82] focus:text-white focus:rounded-lg"
        >
          跳过导航
        </a>
        {children}
        <SiteFilingFooter />
      </body>
    </html>
  );
}

