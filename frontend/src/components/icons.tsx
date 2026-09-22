import type { SVGProps } from 'react';

/**
 * Inline 16px strokes rather than an icon dependency — the set is small enough
 * to own, and inline SVG sidesteps the `img-src 'self'` CSP entirely.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11 3.05 3.05" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
  </Icon>
);

export const MonitorIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" />
    <path d="M5.5 14h5M8 11.25V14" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3M4 6.5 8 3l4 3.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 8.5 3.25 3.25L13 5" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.75" />
    <path d="M10.25 5.75v-2a2 2 0 0 0-2-2h-4.5a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M.9 8S3.6 3.5 8 3.5 15.1 8 15.1 8 12.4 12.5 8 12.5.9 8 .9 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const EyeOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.3 3.8A6.5 6.5 0 0 1 8 3.5c4.4 0 7.1 4.5 7.1 4.5a13 13 0 0 1-2.2 2.7M4 4.7A12.9 12.9 0 0 0 .9 8S3.6 12.5 8 12.5c1 0 1.9-.2 2.7-.6" />
    <path d="m6.6 6.6a2 2 0 0 0 2.8 2.8M2 2l12 12" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.5 8.25a1.5 1.5 0 0 0 1.5 1.25h3.5a1.5 1.5 0 0 0 1.5-1.25l.5-8.25" />
  </Icon>
);

export const RestartIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.15" />
    <path d="M13.5 1.75v3.5H10" />
  </Icon>
);

export const StopIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.75" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 3.4v9.2a.5.5 0 0 0 .77.42l7-4.6a.5.5 0 0 0 0-.84l-7-4.6A.5.5 0 0 0 5 3.4Z" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 1.75 15 14H1L8 1.75Z" />
    <path d="M8 6.25v3.5M8 11.75v.01" />
  </Icon>
);

export const DatabaseIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="8" cy="3.75" rx="5.25" ry="2" />
    <path d="M2.75 3.75v8.5c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-8.5M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2" />
  </Icon>
);

export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </Icon>
);

export const LogOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 14H3.75a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 3.75 2H6M10.5 11 13.5 8l-3-3M13.5 8h-7" />
  </Icon>
);

export const ExternalLinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 2.5h4v4M13.5 2.5 7 9M12 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4h3" />
  </Icon>
);

export const SpinnerIcon = ({ className = '', ...props }: IconProps) => (
  <Icon className={`animate-spin ${className}`} {...props}>
    <path d="M8 1.75a6.25 6.25 0 1 0 6.25 6.25" />
  </Icon>
);

export const CircleIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.25" />
  </Icon>
);

export const CircleCheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="m5.25 8 2 2 3.5-3.75" />
  </Icon>
);

export const CircleXIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5" />
  </Icon>
);

export const CircleDashIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" strokeDasharray="2 2" />
    <path d="M5.5 8h5" />
  </Icon>
);
