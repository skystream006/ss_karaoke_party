import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical } from 'lucide-react';
import './ActionsMenu.css';

export default function ActionsMenu({ label = 'More actions', actions = [] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const availableActions = actions.filter(Boolean);

  useLayoutEffect(() => {
    if (!open) return;
    if (!availableActions.length) {
      setOpen(false);
      return;
    }
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
      top: Math.max(8, anchor.bottom + menu.height + 12 <= window.innerHeight
        ? anchor.bottom + 4 : Math.min(anchor.top - menu.height - 4, window.innerHeight - menu.height - 8)),
    });
  }, [open, availableActions.length]);

  useEffect(() => {
    if (open && position) {
      const target = menuRef.current?.querySelector('button:not(:disabled)') || menuRef.current;
      target?.focus();
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event) => {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  if (!availableActions.length) return null;
  return (
    <>
      <button type="button" ref={triggerRef} className="actions-menu-trigger"
        title={label} aria-label={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { setPosition(null); setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPosition(null);
            setOpen(true);
          } else if (event.key === 'Escape') close();
        }}>
        <EllipsisVertical size={20} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div id={menuId} ref={menuRef} role="menu" tabIndex={-1} aria-label={label}
          className="actions-menu" style={position || { top: 0, left: 0, visibility: 'hidden' }}
          onKeyDown={handleMenuKeyDown}>
          {availableActions.map(({ label: actionLabel, ariaLabel, icon: Icon, run, disabled, danger, spinning, separated }) => (
            <React.Fragment key={actionLabel}>
              {separated && <div className="actions-menu-separator" role="separator" />}
              <button type="button" role="menuitem" tabIndex={-1} disabled={disabled}
                aria-label={ariaLabel || actionLabel}
                className={`actions-menu-item${danger ? ' actions-menu-danger' : ''}`}
                onClick={() => { close(); run(); }}>
                {Icon && <Icon size={16} aria-hidden="true" className={spinning ? 'actions-menu-spinning' : undefined} />}
                <span>{actionLabel}</span>
              </button>
            </React.Fragment>
          ))}
        </div>, document.body
      )}
    </>
  );
}