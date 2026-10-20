import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type ProgressProps = HTMLAttributes<HTMLDivElement> & { value?: number | null };

function Progress({ className, children, value = 0, ...props }: ProgressProps) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
      data-slot="progress"
      className={cn('flex flex-wrap gap-3', className)}
      {...props}
    >
      {children}
      <div className="bg-muted h-1 rounded-full relative flex w-full items-center overflow-x-hidden" data-slot="progress-track">
        <div className="bg-primary h-full transition-all" data-slot="progress-indicator" style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

export { Progress };
