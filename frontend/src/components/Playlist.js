import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './Playlist.css';

export default function Playlist({ queue, onRemove, onReorder, onPlay, onPause, isOrganizer, canReorder, canRemove }) {
  // canReorder/canRemove default to isOrganizer when not explicitly provided
  const allowReorder = canReorder !== undefined ? canReorder : isOrganizer;
  const allowRemove = canRemove !== undefined ? canRemove : isOrganizer;

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
                      <div className="playlist-singer">🎤 {item.singer_name}</div>
                    </div>

                    {/* Actions */}
                    <div className="playlist-actions">
                      {onPlay && item.status !== 'playing' && (
                        <button
                          className="btn-icon-action btn-play"
                          onClick={() => onPlay(item)}
                          title="Play now"
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

