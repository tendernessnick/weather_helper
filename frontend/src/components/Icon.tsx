/** SF-Symbols-style stroke icons. Usage: <Icon name="pin" className="w-4 h-4" /> */
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  ball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.5 5.8c3 2.6 3 9.8 0 12.4M17.5 5.8c-3 2.6-3 9.8 0 12.4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.3-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.7 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  phone: (
    <path d="M6.8 3.8h2.6l1.5 4-2 1.5a11.5 11.5 0 0 0 5.8 5.8l1.5-2 4 1.5v2.6c0 1-.8 1.9-1.9 1.8C10.9 18.3 5.7 13.1 5 5.7c-.1-1 .8-1.9 1.8-1.9Z" />
  ),
  warn: (
    <>
      <path d="M12 4 21 19H3L12 4Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.6" r="0.4" fill="currentColor" />
    </>
  ),
  rain: (
    <>
      <path d="M7 13a4.5 4.5 0 0 1 .4-8.9A5.5 5.5 0 0 1 18 6.5 3.8 3.8 0 0 1 17.5 13H7Z" />
      <path d="M8.5 16.5 7.5 19M13 16.5l-1 2.5M17 16.5l-1 2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </>
  ),
  drizzle: (
    <>
      <path d="M7 12a4.5 4.5 0 0 1 .4-8.9A5.5 5.5 0 0 1 18 5.5 3.8 3.8 0 0 1 17.5 12H7Z" />
      <path d="M8.5 15.5 7.8 17M12 15.5l-.7 1.5M15.5 15.5l-.7 1.5" />
    </>
  ),
  storm: (
    <>
      <path d="M7 12a4.5 4.5 0 0 1 .4-8.9A5.5 5.5 0 0 1 18 5.5 3.8 3.8 0 0 1 17.5 12H7Z" />
      <path d="m12.5 13.5-2.4 3.5h2.8l-2.4 3.5" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.5 14.5a7.5 7.5 0 1 1 15 0" />
      <path d="m12 14.5 3.5-4.5" />
      <circle cx="12" cy="14.5" r="1" fill="currentColor" />
    </>
  ),
  bell: (
    <>
      <path d="M12 4a5.5 5.5 0 0 1 5.5 5.5c0 3 .9 4.6 1.7 5.5H4.8c-.8-.9-1.7-2.5-1.7-5.5A5.5 5.5 0 0 1 12 4Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  drop: <path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5Z" />,
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V8M17 20v-9" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 6.1a3.2 3.2 0 0 1 0 4.9M17.5 14.4c1.7.7 2.7 2.3 3 4.6" />
    </>
  ),
  clockbolt: (
    <>
      <circle cx="11" cy="12" r="8" />
      <path d="M11 8v4.2l2.8 1.6" />
      <path d="m17.5 15-1.2 2h2l-1.6 2.6" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export default function Icon({
  name, className = 'w-4 h-4', strokeWidth = 1.8,
}: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
