import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { PanelRightClose, PanelRightOpen, Wand2 } from "lucide-react";

import StartWithAIAssistant from "./StartWithAIAssistant.jsx";

const AssistantDockContext = createContext({
  openAssistant: () => {},
  closeAssistant: () => {},
  toggleAssistant: () => {},
  minimizeAssistant: () => {},
  isOpen: false,
  isMinimized: false,
});

function buildRouteContext(location) {
  return {
    current_route: `${location.pathname}${location.search || ""}`,
  };
}

export function useAssistantDock() {
  return useContext(AssistantDockContext);
}

function DesktopAssistantDock({
  open,
  minimized,
  title,
  context,
  onClose,
  onMinimize,
}) {
  return (
    <div
      className={`pointer-events-none fixed inset-y-0 right-0 z-40 hidden xl:flex ${
        open ? "translate-x-0 opacity-100" : "translate-x-full invisible opacity-0"
      } transition-transform duration-200`}
      aria-hidden={!open}
    >
      <div
        data-testid="assistant-desktop-dock"
        className={`pointer-events-auto flex h-full border-l border-slate-200 bg-white/95 shadow-2xl backdrop-blur ${
          minimized ? "w-20" : "w-[430px]"
        }`}
      >
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                AI Copilot
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="assistant-desktop-dock-minimize"
                onClick={onMinimize}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
              >
                {minimized ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                data-testid="assistant-desktop-dock-close"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          {minimized ? (
            <div className="flex flex-1 items-center justify-center">
              <Wand2 className="h-6 w-6 text-slate-500" />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <StartWithAIAssistant mode="dock" context={context} onClose={onClose} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AssistantDockProvider({ children }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dockTitle, setDockTitle] = useState("Start with AI");
  const [dockContext, setDockContext] = useState(null);

  const openAssistant = useCallback(
    (options = {}) => {
      setOpen(true);
      setMinimized(false);
      setDockTitle(options.title || "Start with AI");
      setDockContext(options.context || buildRouteContext(location));
    },
    [location]
  );

  const closeAssistant = useCallback(() => {
    setOpen(false);
    setMinimized(false);
  }, []);

  const minimizeAssistant = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  const toggleAssistant = useCallback(() => {
    if (open) {
      closeAssistant();
      return;
    }
    openAssistant();
  }, [closeAssistant, open, openAssistant]);

  const value = useMemo(
    () => ({
      openAssistant,
      closeAssistant,
      minimizeAssistant,
      toggleAssistant,
      isOpen: open,
      isMinimized: minimized,
    }),
    [closeAssistant, minimized, open, openAssistant, toggleAssistant]
  );

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
      <DesktopAssistantDock
        open={open}
        minimized={minimized}
        title={dockTitle}
        context={dockContext || buildRouteContext(location)}
        onClose={closeAssistant}
        onMinimize={minimizeAssistant}
      />
    </AssistantDockContext.Provider>
  );
}
