import { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface GlassHeaderProps {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}

export default function GlassHeader({ left, right, className }: GlassHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-50 liquid-glass rounded-2xl px-6 py-4 flex items-center justify-between border border-white/70 shadow-sm',
        className
      )}
    >
      <div className="flex items-center gap-6">{left}</div>
      {right ? <div className="flex items-center gap-4">{right}</div> : null}
    </header>
  );
}
