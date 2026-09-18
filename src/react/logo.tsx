import { useId } from 'react';

export interface LogScannerLogoProps {
  size: number;
  className?: string;
  /** Omit when nearby text already names the mark, so it stays decorative. */
  label?: string;
}

/** Inline brand mark: the package ships no image file and emits no extra request. */
export function LogScannerLogo({ size, className, label }: LogScannerLogoProps) {
  // Every instance owns its gradient id: a shared one would collide across mounts and with consumer markup.
  const gradientId = `logscan-mark-${useId().replaceAll(':', '')}`;
  return (
    <svg
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      viewBox="0 0 1254 1254"
      width={size}
      height={size}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="229" y1="283" x2="1023" y2="967">
          <stop offset="0%" stopColor="#08EBD8" />
          <stop offset="100%" stopColor="#00DDCF" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeLinecap="round" strokeLinejoin="round">
        <path d="M776 351H574C421 351 299 472 299 625C299 776 421 897 574 897H803" strokeWidth="140" />
        <path d="M575 548.5H962" strokeWidth="122" />
        <path d="M575 704.5H962" strokeWidth="122" />
      </g>
    </svg>
  );
}
