import { useEffect, useId, useRef, type ReactNode } from 'react';

export function SessionDialog({
  title,
  subtitle,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby={heading}>
      <header className="inspection-header">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2 id={heading}>{title}</h2>
        </div>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>
          {closeLabel}
        </button>
      </header>
      {children}
    </dialog>
  );
}
