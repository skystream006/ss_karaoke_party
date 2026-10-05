import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import VideoPlayer from './VideoPlayer';
import { getSSMusicPlayback } from '../services/api';

jest.mock('../services/api', () => ({
  getSSMusicPlayback: jest.fn(() => new Promise(() => {})),
  getSSMusicStreamUrl: jest.fn((path) => `/api${path}`),
}));

let root;
let container;
let players;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  getSSMusicPlayback.mockImplementation(() => new Promise(() => {}));
  players = [];
  window.YT = {
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
    Player: jest.fn((target, options) => {
      let modules = ['captions'];
      const player = {
        getOptions: jest.fn(() => modules),
        unloadModule: jest.fn((module) => {
          modules = modules.filter((name) => name !== module);
          options.events.onApiChange({ target: player });
        }),
        playVideo: jest.fn(),
        pauseVideo: jest.fn(),
        seekTo: jest.fn(),
        setVolume: jest.fn(),
        setPlaybackRate: jest.fn(),
        getCurrentTime: jest.fn(() => 12),
        getDuration: jest.fn(() => 180),
        destroy: jest.fn(),
      };
      players.push({
        player,
        options,
        loadCaptions: () => { modules = ['captions']; },
      });
      return player;
    }),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  jest.useRealTimers();
});

function renderPlayer(props = {}) {
  act(() => root.render(<VideoPlayer videoId="first-song" {...props} />));
  return players[players.length - 1];
}

test('disables captions on ready while retaining autoplay, controls and audio settings', () => {
  const { player, options } = renderPlayer({ settings: { vocalLevel: 75, tempo: 1.25 } });
  expect(options.playerVars).toMatchObject({ cc_load_policy: 0, autoplay: 1, controls: 1 });

  act(() => options.events.onReady({ target: player }));

  expect(player.unloadModule).toHaveBeenCalledTimes(1);
  expect(player.unloadModule).toHaveBeenCalledWith('captions');
  expect(player.unloadModule.mock.invocationCallOrder[0]).toBeLessThan(player.playVideo.mock.invocationCallOrder[0]);
  expect(player.playVideo).toHaveBeenCalledTimes(1);
  expect(player.setVolume).toHaveBeenLastCalledWith(75);
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
});

test('disables late-loaded or re-enabled captions without an API change loop', () => {
  const { player, options, loadCaptions } = renderPlayer();
  act(() => options.events.onReady({ target: player }));
  player.unloadModule.mockClear();

  act(() => options.events.onApiChange({ target: player }));
  expect(player.unloadModule).not.toHaveBeenCalled();

  for (let i = 0; i < 2; i += 1) {
    loadCaptions();
    act(() => options.events.onApiChange({ target: player }));
    expect(player.unloadModule).toHaveBeenCalledTimes(i + 1);
    expect(player.getOptions()).not.toContain('captions');
  }
});

test('disables captions on playback and resume while preserving progress and end events', () => {
  const onTimeUpdate = jest.fn();
  const onEnded = jest.fn();
  const { player, options, loadCaptions } = renderPlayer({ onTimeUpdate, onEnded });
  const changeState = (data) => act(() => options.events.onStateChange({ target: player, data }));

  changeState(window.YT.PlayerState.PLAYING);
  expect(player.unloadModule).toHaveBeenCalledWith('captions');
  act(() => jest.advanceTimersByTime(2000));
  expect(onTimeUpdate).toHaveBeenLastCalledWith(12, 180);

  changeState(window.YT.PlayerState.PAUSED);
  act(() => jest.advanceTimersByTime(2000));
  expect(onTimeUpdate).toHaveBeenCalledTimes(1);

  loadCaptions();
  changeState(window.YT.PlayerState.PLAYING);
  expect(player.unloadModule).toHaveBeenCalledTimes(2);
  act(() => jest.advanceTimersByTime(2000));
  expect(onTimeUpdate).toHaveBeenCalledTimes(2);

  changeState(window.YT.PlayerState.ENDED);
  expect(onEnded).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([[[]], [['other-module']], [undefined]])('ignores absent caption modules (%j)', (modules) => {
  const { player, options } = renderPlayer();
  player.getOptions.mockReturnValue(modules);

  act(() => {
    options.events.onReady({ target: player });
    options.events.onApiChange({ target: player });
    options.events.onStateChange({ target: player, data: window.YT.PlayerState.PLAYING });
  });

  expect(player.unloadModule).not.toHaveBeenCalled();
  expect(player.playVideo).toHaveBeenCalledTimes(1);
});

test.each(['getOptions', 'unloadModule'])('plays normally when %s is unavailable', (method) => {
  const { player, options } = renderPlayer();
  delete player[method];

  act(() => {
    options.events.onReady({ target: player });
    options.events.onApiChange({ target: player });
    options.events.onStateChange({ target: player, data: window.YT.PlayerState.PLAYING });
  });

  expect(player.playVideo).toHaveBeenCalledTimes(1);
});

test('keeps captions disabled across song changes and cleans up the previous player', () => {
  const first = renderPlayer();
  act(() => {
    first.options.events.onReady({ target: first.player });
    first.options.events.onStateChange({ target: first.player, data: window.YT.PlayerState.PLAYING });
  });

  const next = renderPlayer({ videoId: 'next-song' });
  expect(first.player.destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(next.options.videoId).toBe('next-song');
  expect(next.options.playerVars.cc_load_policy).toBe(0);
  act(() => next.options.events.onReady({ target: next.player }));
  expect(next.player.unloadModule).toHaveBeenCalledWith('captions');

  renderPlayer({ videoId: null });
  expect(next.player.destroy).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('No song playing');
});

test('preserves imperative playback controls', () => {
  const ref = createRef();
  const { player } = renderPlayer({ ref });

  act(() => {
    ref.current.seekTo(45);
    ref.current.pauseVideo();
    ref.current.playVideo();
  });

  expect(player.seekTo).toHaveBeenCalledWith(45, true);
  expect(player.pauseVideo).toHaveBeenCalledTimes(1);
  expect(player.playVideo).toHaveBeenCalledTimes(1);
});

test('switches from YouTube to ssMusic without leaving a YouTube player or timer behind', () => {
  const first = renderPlayer();
  act(() => first.options.events.onStateChange({ target: first.player, data: window.YT.PlayerState.PLAYING }));
  renderPlayer({ videoId: 'ssmusic-song', mediaPath: 'owner/music/song.mp3', mediaType: 'audio' });
  expect(first.player.destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(container.querySelector('#yt-player')).toBeNull();
  expect(container.querySelector('.sylt-screen')).not.toBeNull();
  const next = renderPlayer({ videoId: 'next-youtube-song', mediaPath: null });
  expect(next.options.videoId).toBe('next-youtube-song');
  expect(container.querySelector('.sylt-screen')).toBeNull();
});

test('a second queue entry of the same song restarts playback', () => {
  const first = renderPlayer({ playbackKey: 'entry-one' });
  const next = renderPlayer({ playbackKey: 'entry-two' });
  expect(first.player.destroy).toHaveBeenCalledTimes(1);
  expect(next.options.videoId).toBe('first-song');
  expect(players).toHaveLength(2);
});

test('a paused entry remains paused when the player finishes loading', () => {
  const { player, options } = renderPlayer({ paused: true });
  act(() => options.events.onReady({ target: player }));
  expect(player.playVideo).not.toHaveBeenCalled();
  expect(player.pauseVideo).toHaveBeenCalled();
});

test('cancels a delayed YouTube initialization when switching to ssMusic', () => {
  delete window.YT.Player;
  renderPlayer();
  const delayedReady = window.onYouTubeIframeAPIReady;
  renderPlayer({ videoId: 'ssmusic-song', mediaPath: 'owner/music/song.mp3' });
  window.YT.Player = jest.fn();
  act(() => delayedReady());
  expect(window.YT.Player).not.toHaveBeenCalled();
});
