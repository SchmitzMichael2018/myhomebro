import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useGuidedVideo } from './GuidedVideoProvider';

const dockClasses = {
  'top-left': 'left-3 top-3',
  'top-right': 'right-3 top-3 xl:right-[450px]',
  'bottom-left': 'bottom-3 left-3',
  'bottom-right': 'bottom-3 right-3 xl:right-[450px]',
};
const formatTime = (seconds = 0) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function GuidedVideoPlayer() {
  const { state, update, navigateTo } = useGuidedVideo();
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [handled, setHandled] = useState([]);
  const dragRef = useRef(null);
  const video = state.activeVideo;
  const checkpoints = video?.checkpoints || [];
  const nextCheckpoint = useMemo(
    () =>
      checkpoints.find(
        (row) => row.time >= state.currentTime && !handled.includes(row.id)
      ),
    [checkpoints, handled, state.currentTime]
  );

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !video?.videoSource) return;
    node.currentTime = Math.min(
      state.currentTime,
      Number.isFinite(node.duration) ? node.duration : state.currentTime
    );
  }, [video?.id]); // Intentionally restore only when a video changes.

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = state.volume;
    videoRef.current.muted = state.muted;
    videoRef.current.playbackRate = state.playbackRate;
    if (video?.captionsSource && videoRef.current.textTracks?.[0]) {
      videoRef.current.textTracks[0].mode = state.captions
        ? 'showing'
        : 'hidden';
    }
  }, [
    state.captions,
    state.muted,
    state.playbackRate,
    state.volume,
    video?.captionsSource,
  ]);

  useEffect(() => {
    const clamp = () => {
      if (state.dock !== 'free' || window.innerWidth < 768) return;
      const x = Math.min(
        Math.max(8, state.x),
        Math.max(8, window.innerWidth - state.width - 8)
      );
      const y = Math.min(
        Math.max(8, state.y),
        Math.max(8, window.innerHeight - 80)
      );
      if (x !== state.x || y !== state.y) update({ x, y });
    };
    window.addEventListener('resize', clamp);
    clamp();
    return () => window.removeEventListener('resize', clamp);
  }, [state.dock, state.height, state.width, state.x, state.y, update]);

  useEffect(() => {
    if (
      !state.open ||
      state.minimized ||
      !playerRef.current ||
      !globalThis.ResizeObserver
    )
      return;
    const observer = new ResizeObserver(([entry]) => {
      if (window.innerWidth < 768) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (
        Math.abs(width - state.width) > 2 ||
        Math.abs(height - state.height) > 2
      )
        update({ width, height });
    });
    observer.observe(playerRef.current);
    return () => observer.disconnect();
  }, [state.height, state.minimized, state.open, state.width, update]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && state.open && !state.minimized)
        update({ minimized: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.minimized, state.open, update]);

  if (!state.open || !video) return null;
  const checkpoint = state.checkpoint;
  const seek = (value) => {
    const next = Math.max(0, Math.min(video.duration, value));
    if (videoRef.current) videoRef.current.currentTime = next;
    update({ currentTime: next, checkpoint: null });
  };
  const togglePlayback = async () => {
    if (!video.videoSource) {
      setMediaError(
        'Placeholder media is not configured. Set VITE_GUIDED_VIDEO_DIY_SOURCE to a trusted local development video.'
      );
      return;
    }
    try {
      if (videoRef.current.paused) await videoRef.current.play();
      else videoRef.current.pause();
    } catch {
      setMediaError(
        'The tutorial could not play. Check the media source and try again.'
      );
    }
  };
  const continueCheckpoint = () => {
    if (checkpoint)
      setHandled((current) => [...new Set([...current, checkpoint.id])]);
    update({ checkpoint: null });
    videoRef.current?.play().catch(() => {});
  };
  const onTimeUpdate = (event) => {
    const currentTime = event.currentTarget.currentTime;
    update({ currentTime });
    const reached = checkpoints.find(
      (row) =>
        row.pauseInWatchAndDo &&
        currentTime >= row.time &&
        !handled.includes(row.id)
    );
    if (state.mode === 'watch-and-do' && reached) {
      event.currentTarget.pause();
      update({ checkpoint: reached });
    }
  };
  const requestPip = async () => {
    if (
      !document.pictureInPictureEnabled ||
      !videoRef.current?.requestPictureInPicture
    ) {
      setMediaError('Picture-in-picture is not supported in this browser.');
      return;
    }
    try {
      await videoRef.current.requestPictureInPicture();
    } catch {
      setMediaError('Picture-in-picture could not be opened.');
    }
  };
  const restart = () => {
    setHandled([]);
    seek(0);
    videoRef.current?.pause();
  };
  const startDrag = (event) => {
    if (window.innerWidth < 768 || event.target.closest('button,select,input'))
      return;
    const rect = event.currentTarget.parentElement.getBoundingClientRect();
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    const move = (moveEvent) => {
      if (!dragRef.current) return;
      update({
        dock: 'free',
        x: Math.min(
          Math.max(8, moveEvent.clientX - dragRef.current.dx),
          Math.max(8, window.innerWidth - state.width - 8)
        ),
        y: Math.min(
          Math.max(8, moveEvent.clientY - dragRef.current.dy),
          Math.max(8, window.innerHeight - 80)
        ),
      });
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  if (state.minimized) {
    return (
      <aside
        data-testid="guided-video-player"
        className={`fixed z-[60] flex min-h-14 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border border-amber-300/40 bg-slate-950 px-3 py-2 text-white shadow-2xl max-md:inset-x-2 max-md:bottom-2 ${dockClasses[state.dock]}`}
      >
        <button
          type="button"
          aria-label={playing ? 'Pause tutorial' : 'Play tutorial'}
          onClick={togglePlayback}
          className="rounded-lg p-2 focus:ring-2 focus:ring-amber-300"
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          type="button"
          onClick={() => update({ minimized: false })}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-bold">
            {video.title}
          </span>
          <span className="text-xs text-slate-300">
            {formatTime(state.currentTime)}
          </span>
        </button>
        <button
          data-testid="guided-video-restore"
          type="button"
          aria-label="Restore tutorial"
          onClick={() => update({ minimized: false })}
          className="rounded-lg p-2 focus:ring-2 focus:ring-amber-300"
        >
          <Maximize2 />
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={playerRef}
      data-testid="guided-video-player"
      aria-label={`${video.title} tutorial player`}
      className={`fixed z-[60] max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-auto rounded-2xl border border-amber-300/40 bg-slate-950 text-white shadow-2xl max-md:inset-x-2 max-md:bottom-2 max-md:w-auto ${dockClasses[state.dock] || ''}`}
      style={{
        width: `min(${state.width}px, calc(100vw - 1.5rem))`,
        height: `min(${state.height}px, calc(100vh - 1.5rem))`,
        resize: 'both',
        ...(state.dock === 'free' ? { left: state.x, top: state.y } : {}),
      }}
    >
      <header
        onPointerDown={startDrag}
        className="flex cursor-move touch-none items-center gap-2 border-b border-slate-700 px-3 py-2"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">{video.title}</div>
          <div className="text-xs text-amber-200">
            {state.mode === 'watch-and-do' ? 'Watch & Do' : 'Watch'} ·{' '}
            {video.placeholder
              ? 'Development placeholder'
              : `${video.duration} seconds`}
          </div>
        </div>
        <button
          data-testid="guided-video-minimize"
          type="button"
          aria-label="Minimize tutorial"
          onClick={() => update({ minimized: true })}
          className="rounded-lg p-2 focus:ring-2 focus:ring-amber-300"
        >
          <Minimize2 />
        </button>
        <button
          type="button"
          aria-label="Close tutorial"
          onClick={() => update({ open: false, checkpoint: null })}
          className="rounded-lg p-2 focus:ring-2 focus:ring-amber-300"
        >
          <X />
        </button>
      </header>
      <div className="aspect-video bg-black">
        {video.videoSource ? (
          <video
            ref={videoRef}
            data-testid="guided-video-media"
            className="h-full w-full"
            src={video.videoSource}
            poster={video.poster || undefined}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            onError={() =>
              setMediaError(
                'The configured tutorial media could not be loaded.'
              )
            }
            preload="metadata"
          >
            <track
              kind="captions"
              src={video.captionsSource || undefined}
              srcLang="en"
              label="English"
            />
          </video>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-300">
            Placeholder tutorial media
            <br />
            Configure a trusted local video source to preview playback.
          </div>
        )}
      </div>
      <div className="space-y-3 p-3">
        {mediaError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-400/40 bg-rose-950/50 p-3 text-sm"
          >
            {mediaError}
            <button
              type="button"
              onClick={() => setMediaError('')}
              className="ml-2 underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-label="Rewind 10 seconds"
            onClick={() => seek(state.currentTime - 10)}
            className="rounded-lg border border-slate-600 px-2 py-2"
          >
            −10
          </button>
          <button
            data-testid="guided-video-play"
            type="button"
            aria-label={playing ? 'Pause tutorial' : 'Play tutorial'}
            onClick={togglePlayback}
            className="rounded-lg bg-amber-300 p-2 text-slate-950"
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button
            type="button"
            aria-label="Forward 10 seconds"
            onClick={() => seek(state.currentTime + 10)}
            className="rounded-lg border border-slate-600 px-2 py-2"
          >
            +10
          </button>
          <span className="px-1 text-xs">
            {formatTime(state.currentTime)} / {formatTime(video.duration)}
          </span>
          <select
            aria-label="Playback speed"
            value={state.playbackRate}
            onChange={(event) =>
              update({ playbackRate: Number(event.target.value) })
            }
            className="rounded-lg bg-slate-900 p-2 text-sm"
          >
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={state.muted ? 'Unmute' : 'Mute'}
            onClick={() => update({ muted: !state.muted })}
            className="rounded-lg border border-slate-600 p-2"
          >
            {state.muted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={state.volume}
            onChange={(event) =>
              update({ volume: Number(event.target.value), muted: false })
            }
            className="w-20"
          />
          <button
            type="button"
            aria-label={
              state.captions ? 'Turn captions off' : 'Turn captions on'
            }
            disabled={!video.captionsSource}
            onClick={() => update({ captions: !state.captions })}
            className="rounded-lg border border-slate-600 p-2 disabled:opacity-40"
          >
            <Captions />
          </button>
          <button
            type="button"
            aria-label="Picture in picture"
            onClick={requestPip}
            className="rounded-lg border border-slate-600 p-2"
          >
            <PictureInPicture />
          </button>
          <button
            type="button"
            aria-label="Restart tutorial"
            onClick={restart}
            className="rounded-lg border border-slate-600 p-2"
          >
            <RotateCcw />
          </button>
        </div>
        <input
          aria-label="Tutorial position"
          type="range"
          min="0"
          max={video.duration}
          value={state.currentTime}
          onChange={(event) => seek(Number(event.target.value))}
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            data-testid="guided-video-mode"
            aria-label="Playback mode"
            value={state.mode}
            onChange={(event) =>
              update({ mode: event.target.value, checkpoint: null })
            }
            className="rounded-lg bg-slate-900 p-2 text-sm"
          >
            <option value="watch">Watch</option>
            <option value="watch-and-do">Watch & Do</option>
          </select>
          <select
            data-testid="guided-video-dock"
            aria-label="Dock position"
            value={state.dock}
            onChange={(event) => update({ dock: event.target.value })}
            className="rounded-lg bg-slate-900 p-2 text-sm"
          >
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
          </select>
          <button
            type="button"
            onClick={() => navigateTo(state.returnRoute)}
            className="rounded-lg border border-slate-600 px-2 text-sm"
          >
            <CornerDownLeft className="mr-1 inline h-4 w-4" />
            Return to Help
          </button>
        </div>
        {!video.videoSource &&
        state.mode === 'watch-and-do' &&
        nextCheckpoint ? (
          <button
            data-testid="guided-video-preview-checkpoint"
            type="button"
            onClick={() =>
              update({
                currentTime: nextCheckpoint.time,
                checkpoint: nextCheckpoint,
              })
            }
            className="w-full rounded-lg border border-sky-300/50 px-3 py-2 text-sm font-bold text-sky-100"
          >
            Preview next placeholder checkpoint
          </button>
        ) : null}
        {checkpoint ? (
          <section
            role="status"
            aria-live="polite"
            data-testid="guided-video-checkpoint"
            className="rounded-xl border border-sky-300/40 bg-sky-950 p-3"
          >
            <h3 className="font-bold">{checkpoint.title}</h3>
            <p className="mt-1 text-sm text-slate-200">
              {checkpoint.instruction}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {checkpoint.actionRoute ? (
                <button
                  type="button"
                  onClick={() => navigateTo(checkpoint.actionRoute)}
                  className="rounded-lg bg-sky-300 px-3 py-2 font-bold text-sky-950"
                >
                  {checkpoint.actionLabel}
                </button>
              ) : null}
              <button
                data-testid="guided-video-continue"
                type="button"
                onClick={continueCheckpoint}
                className="rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
              >
                Continue video
              </button>
              <button
                type="button"
                onClick={continueCheckpoint}
                className="rounded-lg border border-slate-500 px-3 py-2"
              >
                Skip this step
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Continuing is a manual acknowledgement, not verified completion.
            </p>
          </section>
        ) : nextCheckpoint ? (
          <p className="text-xs text-slate-400">
            Next checkpoint: {nextCheckpoint.title}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setTranscriptOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-700 px-3 py-2 text-sm"
        >
          <span>
            <Captions className="mr-2 inline h-4 w-4" />
            Transcript and chapters
          </span>
          {transcriptOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {transcriptOpen ? (
          <ol className="max-h-40 space-y-2 overflow-auto text-sm">
            {video.transcript.map((row) => (
              <li key={row.time}>
                <button
                  type="button"
                  onClick={() => seek(row.time)}
                  className="w-full rounded-lg bg-slate-900 p-2 text-left focus:ring-2 focus:ring-amber-300"
                >
                  <strong>
                    {formatTime(row.time)} · {row.title}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-300">
                    {row.text}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}
