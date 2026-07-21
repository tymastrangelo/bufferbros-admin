// Minimal inline icon set (24px grid, stroke). No icon library needed.
import type { SVGProps } from "react";

function I({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconToday = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </I>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M8 2v4M16 2v4M3 9h18" />
  </I>
);
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 15.3c2 .6 3.5 2.2 4 4.7" />
  </I>
);
export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </I>
);
export const IconDollar = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M12 2v20M17 6.5c-1-1.5-2.6-2-5-2-3 0-4.5 1.6-4.5 3.5C7.5 12 12 11 15 12.5c2.4 1.2 2 5.5-3 5.5-2.8 0-4.4-.8-5.4-2.4" />
  </I>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </I>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4-4" />
  </I>
);
export const IconPhone = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </I>
);
export const IconMessage = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1.3-3.9A8.38 8.38 0 0 1 3 11.5a8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
  </I>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </I>
);
export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </I>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M20 6 9 17l-5-5" />
  </I>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="m15 18-6-6 6-6" />
  </I>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="m9 18 6-6-6-6" />
  </I>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </I>
);
export const IconCar = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11M5 11h14M5 11a2 2 0 0 0-2 2v4h2m14-6a2 2 0 0 1 2 2v4h-2m-14 0v2h2v-2m-2 0h14m0 0v2h2v-2" />
    <circle cx="7.5" cy="14" r="0.5" fill="currentColor" />
    <circle cx="16.5" cy="14" r="0.5" fill="currentColor" />
  </I>
);
export const IconBlock = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </I>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </I>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </I>
);
export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <I {...p}>
    <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />
    <path d="M19 3.5v3M17.5 5h3" />
  </I>
);
