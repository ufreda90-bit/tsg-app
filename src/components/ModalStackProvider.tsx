import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type OverlayType = 'modal' | 'popover';

type ModalRegistrationOptions = {
  type?: OverlayType;
  modalLike?: boolean;
  closeOnEsc?: boolean;
  blockEscWhenEditing?: boolean;
  priority?: number;
};

type ModalEntry = {
  id: string;
  onClose: () => void;
  onPrimaryAction?: (() => void) | undefined;
  type: OverlayType;
  modalLike: boolean;
  closeOnEsc: boolean;
  blockEscWhenEditing: boolean;
  priority: number;
  openedAt: number;
};

type RegisterModalArgs = {
  id: string;
  onClose: () => void;
  onPrimaryAction?: (() => void) | undefined;
  options?: ModalRegistrationOptions;
};

type ModalStackContextValue = {
  registerModal: (args: RegisterModalArgs) => () => void;
  hasOpenOverlay: boolean;
  hasOpenModalLike: boolean;
  isAnyModalOpen: boolean;
};

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

const isEditingElement = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
};

const isUnexpectedPrimaryShortcutTarget = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
};

export function ModalStackProvider({ children }: PropsWithChildren) {
  const entriesRef = useRef<Map<string, ModalEntry>>(new Map());
  const orderRef = useRef(0);
  const [stackVersion, setStackVersion] = useState(0);
  const scrollLockRef = useRef<{ locked: boolean; overflow: string; paddingRight: string }>({
    locked: false,
    overflow: '',
    paddingRight: ''
  });

  const registerModal = useCallback(({ id, onClose, onPrimaryAction, options }: RegisterModalArgs) => {
    orderRef.current += 1;
    const type = options?.type ?? 'modal';
    const modalLike = options?.modalLike ?? (type === 'modal');
    entriesRef.current.set(id, {
      id,
      onClose,
      onPrimaryAction,
      type,
      modalLike,
      closeOnEsc: options?.closeOnEsc ?? true,
      blockEscWhenEditing: options?.blockEscWhenEditing ?? (type === 'modal'),
      priority: options?.priority ?? 0,
      openedAt: orderRef.current
    });
    setStackVersion((v) => v + 1);

    return () => {
      entriesRef.current.delete(id);
      setStackVersion((v) => v + 1);
    };
  }, []);

  const getTopmostEntry = useCallback((predicate?: (entry: ModalEntry) => boolean) => {
    return Array.from(entriesRef.current.values())
      .filter((entry) => (predicate ? predicate(entry) : true))
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.openedAt - a.openedAt;
      })[0];
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        const topmost = getTopmostEntry((entry) => entry.modalLike);
        if (!topmost?.onPrimaryAction) return;
        if (isUnexpectedPrimaryShortcutTarget(document.activeElement)) return;
        event.preventDefault();
        topmost.onPrimaryAction();
        return;
      }

      if (event.key !== 'Escape') return;

      const topmost = getTopmostEntry((entry) => entry.closeOnEsc);

      if (!topmost) return;
      if (topmost.blockEscWhenEditing && isEditingElement(document.activeElement)) return;

      topmost.onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [getTopmostEntry]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const hasModalLikeOpen = Array.from(entriesRef.current.values()).some((entry) => entry.modalLike);
    const { body, documentElement } = document;

    if (hasModalLikeOpen && !scrollLockRef.current.locked) {
      scrollLockRef.current = {
        locked: true,
        overflow: body.style.overflow,
        paddingRight: body.style.paddingRight
      };
      body.style.overflow = 'hidden';
      const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`;
      }
      return;
    }

    if (!hasModalLikeOpen && scrollLockRef.current.locked) {
      body.style.overflow = scrollLockRef.current.overflow;
      body.style.paddingRight = scrollLockRef.current.paddingRight;
      scrollLockRef.current = { locked: false, overflow: '', paddingRight: '' };
    }
  }, [stackVersion]);

  useEffect(() => {
    return () => {
      if (!scrollLockRef.current.locked || typeof document === 'undefined') return;
      document.body.style.overflow = scrollLockRef.current.overflow;
      document.body.style.paddingRight = scrollLockRef.current.paddingRight;
      scrollLockRef.current = { locked: false, overflow: '', paddingRight: '' };
    };
  }, []);

  const hasOpenOverlay = useMemo(() => entriesRef.current.size > 0, [stackVersion]);
  const hasOpenModalLike = useMemo(
    () => Array.from(entriesRef.current.values()).some((entry) => entry.modalLike),
    [stackVersion]
  );
  const isAnyModalOpen = hasOpenModalLike;
  const contextValue = useMemo(
    () => ({ registerModal, hasOpenOverlay, hasOpenModalLike, isAnyModalOpen }),
    [registerModal, hasOpenOverlay, hasOpenModalLike, isAnyModalOpen]
  );

  return (
    <ModalStackContext.Provider value={contextValue}>
      {children}
    </ModalStackContext.Provider>
  );
}

let modalRegistrationIdSeq = 0;

type UseModalRegistrationArgs = {
  isOpen: boolean;
  onClose: () => void;
  onPrimaryAction?: () => void;
  id?: string;
  options?: ModalRegistrationOptions;
};

export function useModalRegistration({ isOpen, onClose, onPrimaryAction, id, options }: UseModalRegistrationArgs) {
  const context = useContext(ModalStackContext);
  if (!context) {
    throw new Error('useModalRegistration must be used inside ModalStackProvider');
  }

  const modalIdRef = useRef(id ?? `modal-stack-${++modalRegistrationIdSeq}`);
  const onCloseRef = useRef(onClose);
  const onPrimaryActionRef = useRef(onPrimaryAction);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    onPrimaryActionRef.current = onPrimaryAction;
  }, [onPrimaryAction]);

  const { registerModal } = context;
  const type = options?.type;
  const modalLike = options?.modalLike;
  const closeOnEsc = options?.closeOnEsc;
  const blockEscWhenEditing = options?.blockEscWhenEditing;
  const priority = options?.priority;

  useEffect(() => {
    if (!isOpen) return;

    return registerModal({
      id: modalIdRef.current,
      onClose: () => onCloseRef.current(),
      onPrimaryAction: onPrimaryActionRef.current
        ? () => {
          onPrimaryActionRef.current?.();
        }
        : undefined,
      options: {
        type,
        modalLike,
        closeOnEsc,
        blockEscWhenEditing,
        priority
      }
    });
  }, [
    isOpen,
    registerModal,
    type,
    modalLike,
    closeOnEsc,
    blockEscWhenEditing,
    priority
  ]);
}

export function useModalStackState() {
  const context = useContext(ModalStackContext);
  if (!context) {
    throw new Error('useModalStackState must be used inside ModalStackProvider');
  }
  return {
    hasOpenOverlay: context.hasOpenOverlay,
    hasOpenModalLike: context.hasOpenModalLike,
    isAnyModalOpen: context.isAnyModalOpen
  };
}

export function useModalStack() {
  return useModalStackState();
}
