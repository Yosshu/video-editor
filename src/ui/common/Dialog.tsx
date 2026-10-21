import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** 背景クリック・Esc で閉じない */
  modal?: boolean;
}

/** 画面中央に表示するダイアログ（ネイティブの dialog 要素を使う） */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 480,
  modal = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width }}
      onCancel={(e) => {
        e.preventDefault();
        if (!modal) onClose();
      }}
      onMouseDown={(e) => {
        if (!modal && e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        {!modal && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        )}
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}
