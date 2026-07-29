import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getGuidedVideo, resolveGuidedRoute } from './registry';
import { readGuidedVideoState, writeGuidedVideoState } from './storage';
import GuidedVideoPlayer from './GuidedVideoPlayer';

const GuidedVideoContext = createContext(null);

export function GuidedVideoProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const preferences = useRef(readGuidedVideoState());
  const [state, setState] = useState({
    activeVideo: null,
    open: false,
    minimized: false,
    currentTime: 0,
    checkpoint: null,
    returnRoute: '',
    ...preferences.current,
  });
  const update = useCallback(
    (patch) => setState((current) => ({ ...current, ...patch })),
    []
  );
  const openVideo = useCallback(
    (id, mode = preferences.current.mode) => {
      const video = getGuidedVideo(id);
      if (!video) return false;
      const currentTime = Number(preferences.current.progress[id]) || 0;
      setState((current) => ({
        ...current,
        activeVideo: video,
        open: true,
        minimized: false,
        mode,
        currentTime,
        checkpoint: null,
        returnRoute: `${location.pathname}${location.search}`,
      }));
      return true;
    },
    [location.pathname, location.search]
  );
  const navigateTo = useCallback(
    (route) => {
      const resolved = resolveGuidedRoute(route, location.pathname);
      if (resolved) navigate(resolved);
      return Boolean(resolved);
    },
    [location.pathname, navigate]
  );

  useEffect(() => {
    const next = {
      ...state,
      progress: {
        ...state.progress,
        ...(state.activeVideo
          ? { [state.activeVideo.id]: state.currentTime }
          : {}),
      },
    };
    writeGuidedVideoState(next);
    preferences.current = readGuidedVideoState();
  }, [
    state.mode,
    state.dock,
    state.width,
    state.height,
    state.x,
    state.y,
    state.playbackRate,
    state.captions,
    state.muted,
    state.volume,
    state.currentTime,
    state.activeVideo,
    state.progress,
  ]);

  const value = useMemo(
    () => ({ state, update, openVideo, navigateTo }),
    [state, update, openVideo, navigateTo]
  );
  return (
    <GuidedVideoContext.Provider value={value}>
      {children}
      <GuidedVideoPlayer />
    </GuidedVideoContext.Provider>
  );
}

export function useGuidedVideo() {
  const value = useContext(GuidedVideoContext);
  if (!value)
    throw new Error('useGuidedVideo must be used within GuidedVideoProvider');
  return value;
}
