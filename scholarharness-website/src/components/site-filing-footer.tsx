import Image from 'next/image';

export function SiteFilingFooter() {
  return (
    <footer className="border-t border-black/10 bg-white px-5 py-5 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm text-[#6b756d] md:flex-row md:items-center md:justify-between">
        <span>
          © 2026 <span className="brand-roman">Scholar Harness</span>. 保留所有权利。
        </span>
        <span className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
          <a
            href="https://beian.miit.gov.cn/#/Integrated/index"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-[#111411]"
          >
            冀ICP备2026002375-2号
          </a>
          <a
            href="https://beian.mps.gov.cn/#/query/webSearch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-[#111411]"
          >
            <Image
              src="/police-badge.png"
              alt=""
              width={16}
              height={18}
              unoptimized
              aria-hidden="true"
              className="h-4 w-4 shrink-0 object-contain"
            />
            琼公网安备46020002000392号
          </a>
        </span>
      </div>
    </footer>
  );
}
