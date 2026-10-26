import React, { memo, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { LoaderCircle, Pause, Play, Send, Trash2 } from 'lucide-react';
import ActionsMenu from './ActionsMenu';
import MediaThumbnail from './MediaThumbnail';
import './Playlist.css';

const SSMUSIC_PENDING_LABELS = {
  submitting: 'Sending to ssMusic...',
  queued: 'ssMusic: queued',
  running: 'ssMusic: downloading...',
};

function PlaylistActions({ item, onPlay, onPause, onRemove, onSendToSSMusic, pending, failed }) {
  const isPlaying = item.status === 'playing';
  const onPlayback = isPlaying ? onPause : onPlay;
  const playbackLabel = isPlaying ? 'Pause' : item.status === 'paused' ? 'Resume' : 'Play now';
  const actions = [];
  if (onSendToSSMusic && (!item.source || item.source === 'youtube')) {
    actions.push({ label: pending ? 'Sending to ssMusic...' : failed ? 'Resend to ssMusic' : 'Send to ssMusic', icon: pending ? LoaderCircle : Send,
      disabled: pending, spinning: pending, run: () => onSendToSSMusic(item) });
  }
  if (onRemove) actions.push({ label: 'Remove', icon: Trash2, danger: true, disabled: pending, run: () => onRemove(item.id) });

  if (!actions.length && !onPlayback) return null;
  return (
    <div className="playlist-actions">
      {onPlayback && (
        <button type="button" className="playlist-playback-button"
          title={playbackLabel} aria-label={playbackLabel} disabled={pending} onClick={() => onPlayback(item)}>
          {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>
      )}
      <ActionsMenu label={`Actions for ${item.video_title}`} actions={actions} disabled={pending} />
    </div>
  );
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlaylistProgress({ currentTime, duration, onSeek }) {
  // Local drag state for the progress slider so socket updates don't reset
  // the thumb position while the user is scrubbing.
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

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

  return (
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
  );
}

const PlaylistRow = memo(function PlaylistRow({ item, index, allowReorder, onRemove, onPlay, onPause, onSendToSSMusic, jobState, currentTime, duration, onSeek }) {
  const pending = Boolean(jobState?.pending || SSMUSIC_PENDING_LABELS[item.ssmusic_status]);
  const error = jobState?.error || item.ssmusic_error;
  return (
    <Draggable draggableId={item.id} index={index} isDragDisabled={!allowReorder}>
      {(dragProvided, snapshot) => (
        <li
          ref={dragProvided.innerRef}
          {...dragProvided.draggableProps}
          className={`playlist-item ${item.status === 'playing' ? 'playing' : ''} ${item.status === 'played' ? 'played' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
        >
          <div className="playlist-title">{item.video_title}</div>
          <div className="playlist-item-row">
            <div className="playlist-pos">
              {item.status === 'playing' ? <span className="playing-indicator">♪</span> : <span>{item.position}</span>}
            </div>
            {allowReorder && (
              <div {...dragProvided.dragHandleProps} className="drag-handle" title="Drag to reorder">⠿</div>
            )}
            <MediaThumbnail source={item.source} mediaPath={item.media_path}
              thumbnail={item.video_thumbnail} alt={item.video_title} className="playlist-thumb" />
            <div className="playlist-info">
              <div className="playlist-singer">🎤 {item.singer_name}</div>
              {item.source === 'ssmusic' ? (
                <div className="playlist-media-status">{item.kpMedia ? 'kpMedia' : 'ssMusic'}</div>
              ) : pending ? (
                <div className="playlist-media-status" role="status"
                  title={SSMUSIC_PENDING_LABELS[item.ssmusic_status] || SSMUSIC_PENDING_LABELS.submitting}>
                  Video is processing, come back when done
                </div>
              ) : error && (
                <div className="playlist-media-error" role="alert">{error}</div>
              )}
            </div>
            <PlaylistActions item={item} onPlay={onPlay} onPause={onPause}
              onRemove={onRemove} onSendToSSMusic={onSendToSSMusic}
              failed={Boolean(item.ssmusic_status === 'error' || error)} pending={pending} />
          </div>
          {(item.status === 'playing' || item.status === 'paused') && typeof currentTime === 'number' && duration > 0 && (
            <PlaylistProgress currentTime={currentTime} duration={duration} onSeek={onSeek} />
          )}
        </li>
      )}
    </Draggable>
  );
});

export default function Playlist({ queue, onRemove, onReorder, onPlay, onPause, onSendToSSMusic, ssmusicState = {}, isOrganizer, canReorder, canRemove, currentTime, duration, onSeek }) {
  const allowReorder = canReorder !== undefined ? canReorder : isOrganizer;
  const allowRemove = canRemove !== undefined ? canRemove : isOrganizer;

  // Keep all songs sorted by position in a single unified list
  const sortedQueue = useMemo(() => [...queue].sort((a, b) => a.position - b.position), [queue]);

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
              <PlaylistRow
                key={item.id}
                item={item}
                index={index}
                allowReorder={allowReorder}
                onRemove={allowRemove ? onRemove : undefined}
                onPlay={onPlay}
                onPause={onPause}
                onSendToSSMusic={onSendToSSMusic}
                jobState={ssmusicState[item.id]}
                currentTime={item.status === 'playing' || item.status === 'paused' ? currentTime : undefined}
                duration={item.status === 'playing' || item.status === 'paused' ? duration : undefined}
                onSeek={onSeek}
              />
            ))}
            {provided.placeholder}
          </ul>
        )}
      </Droppable>
    </DragDropContext>
  );
}
