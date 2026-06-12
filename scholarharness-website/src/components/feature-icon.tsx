export type IconName =
  | "arrow"
  | "chart"
  | "check"
  | "database"
  | "download"
  | "file"
  | "message"
  | "network"
  | "search"
  | "spark"
  | "windows"
  | "apple";

export function FeatureIcon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const common = {
    className,
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="m7 15 4-4 3 3 5-8" />
          <path d="M8 15h.01" />
          <path d="M12 11h.01" />
          <path d="M15 14h.01" />
          <path d="M19 6h.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 3v11" />
          <path d="m7 9 5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3v5a2 2 0 0 0 2 2h5" />
          <path d="M7 3h7l7 7v11H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M9 15h6" />
          <path d="M9 18h4" />
        </svg>
      );
    case "message":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </svg>
      );
    case "network":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="17" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="m8 7 2.4 3.2" />
          <path d="m16.2 8.4-2.7 2.4" />
          <path d="m8.5 16.5 2.1-2.8" />
          <path d="m15.4 15.6-2-2.2" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
          <path d="M8.5 11h5" />
          <path d="M11 8.5v5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3 10 9 4 12l6 3 2 6 2-6 6-3-6-3-2-6Z" />
          <path d="M5 4v4" />
          <path d="M3 6h4" />
          <path d="M19 16v4" />
          <path d="M17 18h4" />
        </svg>
      );
    case "windows":
      return (
        <svg {...common}>
          <path d="M4 5.5 10.5 4v7H4V5.5Z" />
          <path d="M13.5 3.5 20 2v9h-6.5V3.5Z" />
          <path d="M4 13h6.5v7L4 18.5V13Z" />
          <path d="M13.5 13H20v9l-6.5-1.5V13Z" />
        </svg>
      );
    case "apple":
      return (
        <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.2 2.2c-.9.1-1.9.7-2.5 1.4-.6.7-1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2.7-.8 1.1-1.8.8-2.8Z" />
          <path d="M20.4 17.2c-.5 1.2-.8 1.7-1.5 2.8-1 1.5-2.4 3.3-4.1 3.3-1.5 0-1.9-1-3.9-1s-2.5 1-3.9 1c-1.7 0-3-1.6-4.1-3.1-2.8-4.1-3.1-8.9-1.4-11.5 1.2-1.8 3-2.8 4.7-2.8 1.8 0 2.9 1 4.3 1 1.4 0 2.3-1 4.4-1 1.6 0 3.3.9 4.5 2.4-4 2.2-3.3 7.9 1 8.9Z" />
        </svg>
      );
  }
}
