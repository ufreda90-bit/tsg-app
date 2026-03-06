import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

const TOAST_DEDUPE_TTL_MS = 2500;
const TOAST_GC_TTL_MS = 30_000;

let enqueueToast: ((type: ToastType, message: string) => void) | null = null;

export const toast = {
  success(message: string) {
    if (!enqueueToast) {
      console.warn('[toast] Provider non montato');
      return;
    }
    enqueueToast('success', message);
  },
  error(message: string) {
    if (!enqueueToast) {
      console.warn('[toast] Provider non montato');
      return;
    }
    enqueueToast('error', message);
  },
  info(message: string) {
    if (!enqueueToast) {
      console.warn('[toast] Provider non montato');
      return;
    }
    enqueueToast('info', message);
  }
};

const typeStyles: Record<ToastType, { icon: typeof CheckCircle; className: string }> = {
  success: {
    icon: CheckCircle,
    className: 'bg-emerald-500/90 text-white border-emerald-200/50'
  },
  error: {
    icon: AlertTriangle,
    className: 'bg-rose-500/90 text-white border-rose-200/50'
  },
  info: {
    icon: Info,
    className: 'bg-slate-900/90 text-white border-white/20'
  }
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const recentRef = useRef<Map<string, { ts: number; toastId?: string; count: number }>>(new Map());

  useEffect(() => {
    enqueueToast = (type, message) => {
      const now = Date.now();
      for (const [key, value] of recentRef.current.entries()) {
        if (now - value.ts > TOAST_GC_TTL_MS) {
          recentRef.current.delete(key);
        }
      }

      const dedupeKey = `${type}:${message}`;
      const recent = recentRef.current.get(dedupeKey);
      if (recent && now - recent.ts < TOAST_DEDUPE_TTL_MS) {
        recentRef.current.set(dedupeKey, { ...recent, ts: now, count: recent.count + 1 });
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      recentRef.current.set(dedupeKey, { ts: now, toastId: id, count: 1 });
      setToasts(prev => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
        const last = recentRef.current.get(dedupeKey);
        if (last?.toastId === id) {
          recentRef.current.delete(dedupeKey);
        }
      }, 2500);
    };
    return () => {
      enqueueToast = null;
      recentRef.current.clear();
    };
  }, []);

  return (
    <>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map(t => {
          const Icon = typeStyles[t.type].icon;
          return (
            <div
              key={t.id}
              className={`glass-card border px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-semibold ${typeStyles[t.type].className}`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
