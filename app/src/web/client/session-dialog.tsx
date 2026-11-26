import { useEffect, useId, useRef, type ReactNode } from 'react';

export function SessionDialog({
  title,
  subtitle,
  closeLabel,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  subtitle: string;
  closeLabel: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby={heading}
    >
      <header className="inspection-header">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2 id={heading}>{title}</h2>
        </div>
        <button type="button" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>
          {closeLabel}
        </button>
      </header>
      {children}
    </dialog>
  );
}
