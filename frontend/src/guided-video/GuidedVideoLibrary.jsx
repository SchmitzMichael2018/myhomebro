import { Clapperboard, Play } from 'lucide-react';

import { useGuidedVideo } from './GuidedVideoProvider.jsx';
import { listGuidedVideosForAudience } from './registry.js';

function emitVideoOpened(audience, video, mode) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('mhb:analytics', {
      detail: {
        event: 'guided_video_opened',
        role: audience,
        video: video.id,
        mode,
      },
    })
  );
}

export default function GuidedVideoLibrary({
  audience,
  eyebrow = 'How-To Videos',
  title = 'Learn the MyHomeBro essentials',
  description = 'Watch a complete walkthrough, or use Watch & Do to pause at useful checkpoints while you work.',
}) {
  const { openVideo } = useGuidedVideo();
  const videos = listGuidedVideosForAudience(audience);

  const watchVideo = (video, mode) => {
    if (!openVideo(video.id, mode)) return;
    emitVideoOpened(audience, video, mode);
  };

  return (
    <section
      className="rounded-3xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-5 shadow-[var(--mhb-shadow-card)] sm:p-6"
      aria-labelledby={`guided-videos-title-${audience}`}
      data-testid={`guided-video-library-${audience}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--mhb-text-accent)]">
            {eyebrow}
          </p>
          <h2
            id={`guided-videos-title-${audience}`}
            className="mt-1 text-2xl font-black text-[var(--mhb-text-primary)]"
          >
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--mhb-text-secondary)]">
            {description}
          </p>
        </div>
        <Clapperboard
          aria-hidden="true"
          className="text-[var(--mhb-text-accent)]"
          size={28}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {videos.map((video) => (
          <article
            key={video.id}
            className="overflow-hidden rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)]"
            data-testid={`guided-video-card-${video.id}`}
          >
            <img
              src={video.poster}
              alt=""
              className="aspect-video w-full object-cover"
            />
            <div className="p-4">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">
                {video.category} · {Math.ceil(video.duration / 60)} min
              </div>
              <h3 className="mt-2 text-lg font-black text-[var(--mhb-text-primary)]">
                {video.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--mhb-text-secondary)]">
                {video.summary}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="guided-hub__primary-action"
                  onClick={() => watchVideo(video, 'watch')}
                >
                  <Play aria-hidden="true" size={17} /> Watch video
                </button>
                <button
                  type="button"
                  className="guided-hub__secondary-action"
                  onClick={() => watchVideo(video, 'watch-and-do')}
                >
                  Watch &amp; Do
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
