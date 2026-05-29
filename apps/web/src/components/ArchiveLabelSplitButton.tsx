import { useEffect, useId, useRef, useState } from 'react';

type ArchiveLabel = 'good' | 'bad';

type ArchiveLabelSplitButtonProps = {
  /** Primary button label; default action archives/sets as good. */
  label?: string;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** Called when primary button or a menu item is chosen. */
  onSelect: (archiveLabel: ArchiveLabel) => void;
  /** Menu option labels (defaults: Good fit / Bad fit). */
  goodOptionLabel?: string;
  badOptionLabel?: string;
  /** Disable individual menu options (e.g. current label on archived rows). */
  disableGoodOption?: boolean;
  disableBadOption?: boolean;
};

/**
 * Split button: primary click applies "good"; chevron opens a menu for good/bad.
 */
export function ArchiveLabelSplitButton({
  label = 'Archive',
  disabled = false,
  busy = false,
  busyLabel = 'Working…',
  onSelect,
  goodOptionLabel = 'Good fit',
  badOptionLabel = 'Bad fit',
  disableGoodOption = false,
  disableBadOption = false,
}: ArchiveLabelSplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const choose = (archiveLabel: ArchiveLabel) => {
    setMenuOpen(false);
    onSelect(archiveLabel);
  };

  return (
    <div className='archive-split-btn' ref={rootRef}>
      <button
        type='button'
        className='btn-archive archive-split-btn__main'
        disabled={disabled || busy}
        onClick={() => choose('good')}
      >
        {busy ? busyLabel : label}
      </button>
      <button
        type='button'
        className='btn-archive archive-split-btn__toggle'
        disabled={disabled || busy}
        aria-expanded={menuOpen}
        aria-haspopup='menu'
        aria-controls={menuId}
        aria-label={`${label} options`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ▾
      </button>
      {menuOpen ? (
        <div className='archive-split-btn__menu' id={menuId} role='menu'>
          <button
            type='button'
            role='menuitem'
            className='archive-split-btn__menu-item'
            disabled={disableGoodOption}
            onClick={() => choose('good')}
          >
            {goodOptionLabel}
          </button>
          <button
            type='button'
            role='menuitem'
            className='archive-split-btn__menu-item'
            disabled={disableBadOption}
            onClick={() => choose('bad')}
          >
            {badOptionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
