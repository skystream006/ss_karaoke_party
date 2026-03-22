import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './Playlist.css';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Playlist({ queue, onRemove, onReorder, onPlay, onPause, isOrganizer, canReorder, canRemove, canEditSinger, onUpdateSinger, currentTime, duration, onSeek }) {
  // canReorder/canRemove default to isOrganizer when not explicitly provided
  const allowReorder = canReorder !== undefined ? canReorder : isOrganizer;
  const allowRemove = canRemove !== undefined ? canRemove : isOrganizer;
  const allowEditSinger = canEditSinger !== undefined ? canEditSinger : isOrganizer;

  // Local drag state for the progress slider so socket updates don't reset
  // the thumb position while the user is scrubbing.
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  // Inline singer edit state
  const [editingSingerId, setEditingSingerId] = useState(null);
  const [editingSingerValue, setEditingSingerValue] = useState('');
  const [singerEditLoading, setSingerEditLoading] = useState(false);
  const [singerEditError, setSingerEditError] = useState('');

  const startEditSinger = (item) => {
    setEditingSingerId(item.id);
    setEditingSingerValue(item.singer_name);
    setSingerEditError('');
  };

  const cancelEditSinger = () => {
    setEditingSingerId(null);
    setEditingSingerValue('');
    setSingerEditError('');
  };

  const saveEditSinger = async (item) => {
    const trimmed = editingSingerValue.trim();
    if (!trimmed || trimmed === item.singer_name) {
      cancelEditSinger();
      return;
    }
    setSingerEditLoading(true);
    setSingerEditError('');
    try {
      await onUpdateSinger(item.id, trimmed);
      setEditingSingerId(null);
      setEditingSingerValue('');
    } catch {
      setSingerEditError('Failed to update singer.');
    } finally {
      setSingerEditLoading(false);
    }
  };

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
                    {item.video_thumbnail && (
                      <img
                        src={item.video_thumbnail}
                        alt={item.video_title}
                        className="playlist-thumb"
                      />
                    )}

                    {/* Song info */}
                    <div className="playlist-info">
                      <div className="playlist-title">{item.video_title}</div>
                      {editingSingerId === item.id ? (
                        <div className="playlist-singer-edit">
                          <input
                            className="playlist-singer-input"
                            type="text"
                            value={editingSingerValue}
                            onChange={(e) => setEditingSingerValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditSinger(item);
                              if (e.key === 'Escape') cancelEditSinger();
                            }}
                            autoFocus
                            maxLength={255}
                          />
                          <button
                            className="btn-singer-save"
                            onClick={() => saveEditSinger(item)}
                            disabled={singerEditLoading || !editingSingerValue.trim()}
                            title="Save"
                          >
                            ✓
                          </button>
                          <button
                            className="btn-singer-cancel"
                            onClick={cancelEditSinger}
                            title="Cancel"
                          >
                            ✕
                          </button>
                          {singerEditError && (
                            <span className="singer-edit-error">{singerEditError}</span>
                          )}
                        </div>
                      ) : (
                        <div className="playlist-singer">
                          🎤 {item.singer_name}
                          {allowEditSinger && (
                            <button
                              className="btn-singer-edit"
                              onClick={() => startEditSinger(item)}
                              title="Change singer"
                            >
                              ✏️
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="playlist-actions">
                      {onPlay && item.status !== 'playing' && (
                        <button
                          className="btn-icon-action btn-play"
                          onClick={() => onPlay(item)}
                          title={item.status === 'paused' ? 'Resume' : 'Play now'}
                        >
                          ▶
                        </button>
                      )}
                      {onPause && item.status === 'playing' && (
                        <button
                          className="btn-icon-action btn-pause"
                          onClick={() => onPause(item)}
                          title="Pause"
                        >
                          ⏸
                        </button>
                      )}
                      {allowRemove && (
                        <button
                          className="btn-icon-action btn-remove"
                          onClick={() => onRemove(item.id)}
                          title="Remove"
                        >
                          ✕
                        </button>
                      )}
                    </div>
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

