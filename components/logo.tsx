import { cn } from '@/lib/utils';

export function LogoMark({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={4.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d="M12.5 28V10.5C12.5 6.6 15.1 4 19 4h3.5" />
      <path d="M7 16.5h7.4c3.9 0 6.9-1.9 9.1-5.2" />
    </svg>
  );
}

export function Wordmark({
  className,
  size = 'md',
  withMark = true,
  accent,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  withMark?: boolean;
  /** Optional small italic accent after the mark, e.g. "crm" */
  accent?: string;
}) {
  const sizeMap = {
    sm: { mark: 'h-4 w-4', text: 'text-base' },
    md: { mark: 'h-5 w-5', text: 'text-2xl' },
    lg: { mark: 'h-7 w-7', text: 'text-3xl' },
  } as const;
  const s = sizeMap[size];

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {withMark ? (
        <span
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground',
            size === 'sm' ? 'h-6 w-6 p-1' : size === 'md' ? 'h-8 w-8 p-1.5' : 'h-10 w-10 p-2',
          )}
        >
          <LogoMark className={s.mark} />
        </span>
      ) : null}
      <span
        className={cn(
          'font-display font-medium leading-none tracking-tight',
          s.text,
        )}
      >
        Forkable
        {accent ? (
          <span className="ml-1.5 italic text-primary">{accent}</span>
        ) : null}
      </span>
    </span>
  );
}
