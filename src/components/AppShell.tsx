import { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface AppShellProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function AppShell({ children, className, contentClassName }: AppShellProps) {
  return (
    <div className={cn('min-h-screen relative overflow-x-hidden bg-[#F8FAFC]', className)}>
      <div className="liquid-blob bg-[#FFEFD5] w-[700px] h-[700px] -top-64 -left-32" />
      <div className="liquid-blob bg-[#E0F2FE] w-[800px] h-[800px] top-1/2 -right-64 -translate-y-1/2" />
      <div className="liquid-blob bg-[#FDF2F8] w-[520px] h-[520px] -bottom-40 left-1/3" />

      <div
        className={cn(
          'relative z-10 min-h-screen flex flex-col px-4 sm:px-6 lg:px-10 py-6 gap-6',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
