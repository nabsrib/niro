import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Icons = {
  select: () => (
    <Svg>
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </Svg>
  ),
  hand: () => (
    <Svg>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5v-7a1.5 1.5 0 013 0V12M14 11.5V6.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-4.6-2.2L3.7 15a1.6 1.6 0 012.4-2L8 15" />
    </Svg>
  ),
  sticky: () => (
    <Svg>
      <path d="M4 4h16v10l-6 6H4z" />
      <path d="M14 20v-6h6" />
    </Svg>
  ),
  text: () => (
    <Svg>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </Svg>
  ),
  rect: () => (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
    </Svg>
  ),
  ellipse: () => (
    <Svg>
      <circle cx="12" cy="12" r="8" />
    </Svg>
  ),
  connector: () => (
    <Svg>
      <path d="M4 19C10 19 8 6 18 6" />
      <path d="M15 3l4 3-3 4" />
    </Svg>
  ),
  lineStraight: () => (
    <Svg>
      <path d="M5 19L19 5" />
    </Svg>
  ),
  lineElbow: () => (
    <Svg>
      <path d="M4 19h8V5h8" />
    </Svg>
  ),
  lineCurved: () => (
    <Svg>
      <path d="M4 19C12 19 12 5 20 5" />
    </Svg>
  ),
  arrowStart: () => (
    <Svg>
      <path d="M20 12H5" />
      <path d="M9 7l-5 5 5 5" fill="currentColor" />
    </Svg>
  ),
  arrowEnd: () => (
    <Svg>
      <path d="M4 12h15" />
      <path d="M15 7l5 5-5 5" fill="currentColor" />
    </Svg>
  ),
  undo: () => (
    <Svg>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </Svg>
  ),
  redo: () => (
    <Svg>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 000 12h3" />
    </Svg>
  ),
  plus: () => (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  minus: () => (
    <Svg>
      <path d="M5 12h14" />
    </Svg>
  ),
  fit: () => (
    <Svg>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  ),
  trash: () => (
    <Svg>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </Svg>
  ),
  front: () => (
    <Svg>
      <rect x="9" y="9" width="11" height="11" rx="1.5" fill="currentColor" />
      <path d="M15 5V4H4v11h1" />
    </Svg>
  ),
  back: () => (
    <Svg>
      <rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" />
      <path d="M19 9h1v11H9v-1" />
    </Svg>
  ),
};
