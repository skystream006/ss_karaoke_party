import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './Playlist.css';

export default function Playlist({ queue, onRemove, onReorder, onPlay, isOrganizer, canReorder, canRemove }) {
  // canReorder/canRemove default to isOrganizer when not explicitly provided
  const allowReorder = canReorder !== undefined ? canReorder : isOrganizer;
  const allowRemove = canRemove !== undefined ? canRemove : isOrganizer;

  const activeQueue = queue.filter((i) => i.status !== 'played');
  const playedQueue = queue.filter((i) => i.status === 'played');

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const newActive = Array.from(activeQueue);
    const [moved] = newActive.splice(result.source.index, 1);
    newActive.splice(result.destination.index, 0, moved);

    // Assign new positions starting after the highest played-song position to avoid conflicts
    const maxPlayedPosition = playedQueue.length > 0
      ? Math.max(...playedQueue.map((i) => i.position))
      : 0;
    const reordered = newActive.map((item, idx) => ({ ...item, position: maxPlayedPosition + idx + 1 }));
    onReorder(reordered);
  };

  if (activeQueue.length === 0 && playedQueue.length === 0) {
    return (
      <div className="playlist-empty">
        <span>🎵</span>
        <p>No songs in queue yet</p>
        <p className="muted">Guests can search and add songs!</p>
      </div>
    );
  }

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="playlist" isDropDisabled={!allowReorder}>
          {(provided) => (
            <ul
              className="playlist-list"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {activeQueue.map((item, index) => (
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
                      className={`playlist-item ${item.status === 'playing' ? 'playing' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
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
                        {isOrganizer && item.status !== 'playing' && (
                          <button
                            className="btn-icon-action btn-play"
                            onClick={() => onPlay && onPlay(item)}
                            title="Play now"
                          >
                            ▶
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

      {playedQueue.length > 0 && (
        <div className="playlist-played-section">
          <div className="playlist-played-heading">✓ Played</div>
          <ul className="playlist-list">
            {playedQueue.map((item) => (
              <li key={item.id} className="playlist-item played">
                <div className="playlist-pos">
                  <span className="played-indicator">✓</span>
                </div>

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
                {allowRemove && (
                  <div className="playlist-actions">
                    <button
                      className="btn-icon-action btn-remove"
                      onClick={() => onRemove(item.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
