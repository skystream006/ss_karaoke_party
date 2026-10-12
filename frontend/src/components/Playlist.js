import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { EllipsisVertical, LoaderCircle, Pause, Play, Send, Trash2 } from 'lucide-react';
import MediaThumbnail from './MediaThumbnail';
import './Playlist.css';

const SSMUSIC_PENDING_LABELS = {
  submitting: 'Sending to ssMusic...',
  queued: 'ssMusic: queued',
  running: 'ssMusic: downloading...',
};

function PlaylistActions({ item, onPlay, onPause, onRemove, onSendToSSMusic, pending }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const actions = [];
  if (onPlay && item.status !== 'playing') {
    actions.push({ label: item.status === 'paused' ? 'Resume' : 'Play now', icon: Play, run: () => onPlay(item) });
  }
  if (onPause && item.status === 'playing') {
    actions.push({ label: 'Pause', icon: Pause, run: () => onPause(item) });
  }
  if (onSendToSSMusic && (!item.source || item.source === 'youtube')) {
    actions.push({ label: pending ? 'Sending to ssMusic...' : 'Send to ssMusic', icon: pending ? LoaderCircle : Send,
      disabled: pending, run: () => onSendToSSMusic(item) });
  }
  if (onRemove) actions.push({ label: 'Remove', icon: Trash2, danger: true, run: () => onRemove(item.id) });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
      top: Math.max(8, anchor.bottom + menu.height + 12 <= window.innerHeight
        ? anchor.bottom + 4 : Math.min(anchor.top - menu.height - 4, window.innerHeight - menu.height - 8)),
    });
  }, [open, actions.length]);

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
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  if (!actions.length) return null;
  return (
    <div className="playlist-actions">
      <button type="button" ref={triggerRef} className="playlist-menu-trigger"
        title="More actions" aria-label={`Actions for ${item.video_title}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { setPosition(null); setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape') close();
        }}>
        <EllipsisVertical size={20} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div id={menuId} ref={menuRef} role="menu" tabIndex={-1} aria-label={`Actions for ${item.video_title}`}
          className="playlist-menu" style={position || { top: 0, left: 0, visibility: 'hidden' }}
          onKeyDown={handleMenuKeyDown}>
          {actions.map(({ label, icon: Icon, run, disabled, danger }) => (
            <button type="button" role="menuitem" key={label} disabled={disabled}
              className={`playlist-menu-item${danger ? ' playlist-menu-danger' : ''}`}
              onClick={() => { close(); run(); }}>
              <Icon size={16} aria-hidden="true" className={disabled ? 'playlist-sending-icon' : undefined} />
              <span>{label}</span>
            </button>
          ))}
        </div>, document.body
      )}
    </div>
  );
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Playlist({ queue, onRemove, onReorder, onPlay, onPause, onSendToSSMusic, ssmusicState = {}, isOrganizer, canReorder, canRemove, currentTime, duration, onSeek }) {
  // canReorder/canRemove default to isOrganizer when not explicitly provided
  const allowReorder = canReorder !== undefined ? canReorder : isOrganizer;
  const allowRemove = canRemove !== undefined ? canRemove : isOrganizer;

  // Local drag state for the progress slider so socket updates don't reset
  // the thumb position while the user is scrubbing.
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const showSlider = typeof currentTime === 'number' && duration > 0;
  const sliderValue = isDragging ? dragValue : Math.floor(currentTime || 0);

  const handleSliderMouseDown = (e) => {
    setIsDragging(true);
    setDragValue(Number(e.target.value));
  };
  const handleSliderChange = (e) => {
    setDragValue(Number(e.target.value));
  };
  const handleSliderCommit = (e) => {
    const val = Number(e.target.value);
    if (onSeek) onSeek(val);
    setIsDragging(false);
  };

  // Keep all songs sorted by position in a single unified list
  const sortedQueue = [...queue].sort((a, b) => a.position - b.position);

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const newQueue = Array.from(sortedQueue);
    const [moved] = newQueue.splice(result.source.index, 1);
    newQueue.splice(result.destination.index, 0, moved);

    // Assign sequential positions starting from 1
    const reordered = newQueue.map((item, idx) => ({ ...item, position: idx + 1 }));
    onReorder(reordered);
  };

  if (sortedQueue.length === 0) {
    return (
      <div className="playlist-empty">
        <span>🎵</span>
        <p>No songs in queue yet</p>
        <p className="muted">Guests can search and add songs!</p>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="playlist" isDropDisabled={!allowReorder}>
        {(provided) => (
          <ul
            className="playlist-list"
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {sortedQueue.map((item, index) => (
              <Draggable
                key={item.id}
                draggableId={item.id}
                index={index}
                isDragDisabled={!allowReorder}
              >
                {(dragProvided, snapshot) => (
                  <li
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    className={`playlist-item ${item.status === 'playing' ? 'playing' : ''} ${item.status === 'played' ? 'played' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
                  >
                    <div className="playlist-item-row">
                    {/* Position number */}
                    <div className="playlist-pos">
                      {item.status === 'playing' ? (
                        <span className="playing-indicator">♪</span>
                      ) : (
                        <span>{item.position}</span>
                      )}
                    </div>

                    {/* Drag handle */}
                    {allowReorder && (
                      <div
                        {...dragProvided.dragHandleProps}
                        className="drag-handle"
                        title="Drag to reorder"
                      >
                        ⠿
                      </div>
                    )}

                    {/* Thumbnail */}
                    <MediaThumbnail source={item.source} mediaPath={item.media_path}
                      thumbnail={item.video_thumbnail} alt={item.video_title} className="playlist-thumb" />

                    {/* Song info */}
                    <div className="playlist-info">
                      <div className="playlist-title">{item.video_title}</div>
                      <div className="playlist-singer">🎤 {item.singer_name}</div>
                      {item.source === 'ssmusic' ? (
                        <div className="playlist-media-status">{item.kpMedia ? 'kpMedia' : 'ssMusic'}</div>
                      ) : ssmusicState[item.id]?.pending || SSMUSIC_PENDING_LABELS[item.ssmusic_status] ? (
                        <div className="playlist-media-status" role="status">
                          {SSMUSIC_PENDING_LABELS[item.ssmusic_status] || SSMUSIC_PENDING_LABELS.submitting}
                        </div>
                      ) : (ssmusicState[item.id]?.error || item.ssmusic_error) && (
                        <div className="playlist-media-error" role="alert">{ssmusicState[item.id]?.error || item.ssmusic_error}</div>
                      )}
                    </div>

                    {/* Actions */}
                    <PlaylistActions item={item} onPlay={onPlay} onPause={onPause}
                      onRemove={allowRemove ? onRemove : undefined} onSendToSSMusic={onSendToSSMusic}
                      pending={Boolean(ssmusicState[item.id]?.pending || SSMUSIC_PENDING_LABELS[item.ssmusic_status])} />
                    </div>

                    {/* Progress slider – shown for the currently playing or paused item */}
                    {(item.status === 'playing' || item.status === 'paused') && showSlider && (
                      <div className="playlist-progress">
                        <span className="progress-time">{formatTime(sliderValue)}</span>
                        <input
                          type="range"
                          className="progress-slider"
                          min={0}
                          max={Math.floor(duration)}
                          step={1}
                          value={sliderValue}
                          onChange={handleSliderChange}
                          onMouseDown={handleSliderMouseDown}
                          onTouchStart={handleSliderMouseDown}
                          onMouseUp={handleSliderCommit}
                          onTouchEnd={handleSliderCommit}
                        />
                        <span className="progress-time">{formatTime(duration)}</span>
                      </div>
                    )}
                  </li>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </ul>
        )}
      </Droppable>
    </DragDropContext>
  );
}

