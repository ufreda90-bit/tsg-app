import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Command, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';

export type CommandPaletteItem = {
  id: string;
  label: string;
  to: string;
  keywords?: string[];
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandPaletteItem[];
}

export default function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = useMemo(() => {
    if (!normalizedQuery) return commands;
    return commands.filter((command) => {
      const haystack = [command.label, command.to, ...(command.keywords ?? [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [commands, normalizedQuery]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!filteredCommands[activeIndex]) {
      setActiveIndex(0);
    }
  }, [filteredCommands, activeIndex, open]);

  useEffect(() => {
    if (open) return;
    if (!previousFocusRef.current) return;
    requestAnimationFrame(() => {
      previousFocusRef.current?.focus();
    });
  }, [open]);

  const handleNavigate = (command: CommandPaletteItem) => {
    navigate(command.to);
    onClose();
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredCommands.length === 0) return;
      setActiveIndex((index) => (index + 1) % filteredCommands.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredCommands.length === 0) return;
      setActiveIndex((index) => (index - 1 + filteredCommands.length) % filteredCommands.length);
      return;
    }

    if (event.key === 'Enter') {
      const selectedCommand = filteredCommands[activeIndex];
      if (!selectedCommand) return;
      event.preventDefault();
      handleNavigate(selectedCommand);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/35 backdrop-blur-[2px] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette comandi"
        className="mx-auto mt-[12vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-[var(--surface)] shadow-[0_30px_80px_-40px_rgba(15,23,42,0.65)]"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Vai a pagina..."
            className="w-full bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-slate-400"
            aria-label="Cerca pagina"
          />
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
            <Command className="h-3 w-3" />
            K
          </span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="rounded-lg px-3 py-4 text-sm text-slate-500">
              Nessun risultato
            </div>
          ) : (
            filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onClick={() => handleNavigate(command)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'motion-premium flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                  index === activeIndex
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <span className="font-medium">{command.label}</span>
                <span className="text-xs text-slate-500">{command.to}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
