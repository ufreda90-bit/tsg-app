import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, Bell, LayoutGrid, Menu, Moon, Search, Settings, Sun, Users, Wrench, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { useTheme } from '../lib/useTheme';
import { useModalRegistration, useModalStackState } from './ModalStackProvider';
import CommandPalette, { type CommandPaletteItem } from './CommandPalette';

interface AppLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  hideHeaderSearch?: boolean;
  contentClassName?: string;
  brandTitle?: string;
  brandSubtitle?: string;
  headerInlineContent?: ReactNode;
}

type SidebarItem = {
  key: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
};

const sidebarItems: SidebarItem[] = [
  { key: 'planner', label: 'Planner', to: '/dispatcher', icon: LayoutGrid },
  { key: 'customers', label: 'Clienti', to: '/customers', icon: Users },
  { key: 'teams', label: 'Squadre', to: '/teams', icon: Wrench },
  { key: 'stats', label: 'Statistiche', to: '/stats', icon: BarChart3 },
  { key: 'settings', label: 'Impostazioni', to: '/settings', icon: Settings }
];

function getUserInitials(name?: string) {
  if (!name) return 'U';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

export default function AppLayout({
  title,
  subtitle,
  children,
  searchPlaceholder = 'Cerca...',
  onSearchChange,
  hideHeaderSearch = false,
  contentClassName,
  brandTitle = '',
  brandSubtitle = 'Control Panel',
  headerInlineContent
}: AppLayoutProps) {
  const { user, role, logout } = useAuth();
  const { effectiveTheme, toggleLightDark } = useTheme();
  const location = useLocation();
  const [searchValue, setSearchValue] = useState('');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasMobileNavOpenRef = useRef(false);
  const { hasOpenModalLike } = useModalStackState();
  const initials = useMemo(() => getUserInitials(user?.name), [user?.name]);
  const isLogoutAvailable = typeof logout === 'function';
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () =>
      sidebarItems.map((item) => ({
        id: item.key,
        label: item.label,
        to: item.to,
        keywords: [item.key]
      })),
    []
  );
  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    onSearchChange?.(value);
  };

  const handleLogout = () => {
    if (!isLogoutAvailable) return;
    void logout();
  };

  useModalRegistration({
    id: 'app-layout-mobile-nav',
    isOpen: isMobileNavOpen,
    onClose: () => setIsMobileNavOpen(false),
    options: {
      closeOnEsc: true,
      blockEscWhenEditing: false,
      priority: 220
    }
  });

  useModalRegistration({
    id: 'app-layout-command-palette',
    isOpen: isCommandPaletteOpen,
    onClose: closeCommandPalette,
    options: {
      closeOnEsc: true,
      blockEscWhenEditing: false,
      priority: 190
    }
  });

  useEffect(() => {
    setIsMobileNavOpen(false);
    closeCommandPalette();
  }, [location.pathname, closeCommandPalette]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;
      if (event.defaultPrevented) return;
      if (hasOpenModalLike && !isCommandPaletteOpen) return;
      event.preventDefault();
      setIsCommandPaletteOpen((prev) => !prev);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hasOpenModalLike, isCommandPaletteOpen]);

  useEffect(() => {
    if (isMobileNavOpen) {
      previousFocusedElementRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        mobileNavRef.current?.focus();
      });
    } else if (wasMobileNavOpenRef.current) {
      if (mobileNavTriggerRef.current) {
        mobileNavTriggerRef.current.focus();
      } else {
        previousFocusedElementRef.current?.focus();
      }
    }
    wasMobileNavOpenRef.current = isMobileNavOpen;
  }, [isMobileNavOpen]);

  const renderSidebarContent = (isMobile: boolean) => (
    <>
      <div className="px-6 py-6 border-b border-slate-800 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/icon-192x192.png"
            alt="Logo aziendale TSG"
            className="h-[52px] w-[52px] shrink-0 rounded-md object-contain bg-white/5 p-1 border border-slate-700/80"
          />
          <div className="min-w-0">
            {brandTitle ? <p className="text-xs uppercase tracking-[0.14em] text-slate-400 truncate">{brandTitle}</p> : null}
            {brandSubtitle ? <h1 className="text-lg font-bold mt-1 truncate">{brandSubtitle}</h1> : null}
          </div>
        </div>
        {isMobile ? (
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(false)}
            className="motion-premium rounded-md p-2 border border-slate-700 text-slate-300 hover:bg-[var(--sidebar-item-hover)] hover:text-white"
            aria-label="Chiudi navigazione"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 px-4 py-5 space-y-1.5">
        {sidebarItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.to);
          const baseClass =
            'sidebar-item-premium motion-premium w-full flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm border-l-4 border-l-transparent';
          const content = (
            <span className="flex items-center gap-3">
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </span>
          );

          return (
            <Link
              key={item.key}
              to={item.to}
              onClick={isMobile ? () => setIsMobileNavOpen(false) : undefined}
              data-active={isActive ? 'true' : undefined}
              className={cn(
                baseClass,
                isActive ? 'is-active' : 'text-slate-400'
              )}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 rounded-md bg-[var(--sidebar-item)] border border-slate-800 px-3 py-2.5">
          <div className="w-9 h-9 rounded-full bg-[var(--sidebar-item)] flex items-center justify-center text-sm font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user?.name || 'Utente'}</div>
            <div className="text-xs text-slate-400">{role || 'Ruolo'}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          disabled={!isLogoutAvailable}
          className={cn(
            'mt-3 w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm font-medium text-slate-300 motion-premium',
            isLogoutAvailable ? 'hover:bg-[var(--sidebar-item-hover)] hover:text-white' : 'opacity-60 cursor-not-allowed'
          )}
        >
          Esci
        </button>
      </div>
    </>
  );

  const ThemeToggleIcon = effectiveTheme === 'dark' ? Sun : Moon;
  const themeToggleLabel = effectiveTheme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro';

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {isMobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="mobile-navigation"
            ref={mobileNavRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigazione principale"
            tabIndex={-1}
            className="sidebar-premium absolute inset-y-0 left-0 w-[272px] text-slate-100 flex flex-col"
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      ) : null}

      <aside className="sidebar-premium hidden lg:flex fixed inset-y-0 left-0 w-[272px] text-slate-100 flex-col">
        {renderSidebarContent(false)}
      </aside>

      <div className="lg:pl-[272px] min-h-screen flex flex-col">
        <header className="sticky top-0 z-40 bg-[var(--surface)] border-b border-[var(--border)]">
          <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                ref={mobileNavTriggerRef}
                onClick={() => setIsMobileNavOpen(true)}
                className="motion-premium lg:hidden rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                aria-label="Apri navigazione"
                aria-expanded={isMobileNavOpen}
                aria-controls="mobile-navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text)] truncate">{title}</h2>
                {subtitle && <p className="text-sm text-[var(--muted)] mt-0.5 truncate">{subtitle}</p>}
              </div>
            </div>
            {headerInlineContent ? (
              <div className="hidden lg:flex min-w-0 flex-1 justify-start">
                {headerInlineContent}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              {!hideHeaderSearch ? (
                <div className="relative w-64 max-w-[44vw]">
                  <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={searchValue}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 py-2 text-sm text-[var(--text)] outline-none"
                    placeholder={searchPlaceholder}
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={toggleLightDark}
                className="motion-premium rounded-md p-2.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                title={themeToggleLabel}
                aria-label={themeToggleLabel}
              >
                <ThemeToggleIcon className="w-4 h-4" />
              </button>
              <button className="motion-premium rounded-md p-2.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]">
                <Bell className="w-4 h-4 text-[var(--muted)]" />
              </button>
              <div className="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-sm font-semibold text-[var(--muted)]">
                {initials}
              </div>
            </div>
          </div>
        </header>

        <main className={cn('flex-1 px-4 sm:px-6 lg:px-8 py-6', contentClassName)}>
          {children}
        </main>
      </div>
      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={closeCommandPalette}
        commands={commandPaletteItems}
      />
    </div>
  );
}
