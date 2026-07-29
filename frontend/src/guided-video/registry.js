const diyCheckpoints = [
  [
    'create',
    8,
    'Create a private DIY project',
    'Create a project for the improvement you want to plan. It remains private until you choose to request professional help.',
    'Create project',
    '/portal/:token?workspace=diy-planner&action=create',
  ],
  [
    'describe',
    18,
    'Describe the goal and existing conditions',
    'Record the result you want, the current condition, and any work already completed.',
    'Open project details',
    '/portal/:token?workspace=diy-planner&section=overview',
  ],
  [
    'evidence',
    30,
    'Add photos and measurements',
    'Add project photos and any measurements you already know. Homeowner-provided measurements may still require confirmation.',
    'Add project details',
    '/portal/:token?workspace=diy-planner&section=design',
  ],
  [
    'suggest',
    42,
    'Request a suggested plan',
    'Ask Project Assistant for an editable suggested plan.',
    'Open Project Assistant plan',
    '/portal/:token?workspace=diy-planner&section=overview',
  ],
  [
    'review',
    54,
    'Review before applying',
    'Select only the suggested phases and tasks that fit your project. Nothing is added until you apply it.',
    'Review suggestions',
    '/portal/:token?workspace=diy-planner&section=overview',
  ],
  [
    'participation',
    66,
    'Decide how each task will be handled',
    'Mark tasks as Doing Myself, Need Expert Guidance, Need Hands-On Help, Need a Professional, or Undecided.',
    'Open plan',
    '/portal/:token?workspace=diy-planner&section=plan',
  ],
  [
    'progress',
    78,
    'Track progress',
    'Start a task, record progress, and add photos as you work.',
    'Track progress',
    '/portal/:token?workspace=diy-planner&section=progress',
  ],
  [
    'help',
    90,
    'Get help with selected work',
    'Select the tasks or phases where you want professional help and prepare a private request draft.',
    'Prepare help draft',
    '/portal/:token?workspace=diy-planner&section=get-help',
  ],
  [
    'review-request',
    102,
    'Review before contacting contractors',
    'Review the request carefully. Creating the draft does not automatically contact a contractor.',
    'Open Requests',
    '/portal/:token?workspace=requests',
  ],
].map(([id, time, title, instruction, actionLabel, actionRoute]) => ({
  id,
  time,
  title,
  instruction,
  actionLabel,
  actionRoute,
  pauseInWatchAndDo: true,
  completion: { type: 'manual-acknowledgement' },
}));

export const guidedVideoRegistry = {
  'diy-doesnt-mean-alone': {
    id: 'diy-doesnt-mean-alone',
    title: 'DIY Doesn’t Mean Doing It Alone',
    summary:
      'Plan privately, use Project Assistant thoughtfully, and choose where professional help fits.',
    audience: ['homeowner'],
    category: 'DIY planning',
    workspace: 'diy-planner',
    duration: 120,
    videoSource: import.meta.env.VITE_GUIDED_VIDEO_DIY_SOURCE || '',
    poster: '',
    captionsSource: import.meta.env.VITE_GUIDED_VIDEO_DIY_CAPTIONS || '',
    transcript: diyCheckpoints.map((checkpoint) => ({
      time: checkpoint.time,
      title: checkpoint.title,
      text: checkpoint.instruction,
    })),
    defaultRoute: '/portal/:token?workspace=diy-planner',
    status: 'development',
    version: 1,
    updatedDate: '2026-07-29',
    placeholder: true,
    checkpoints: diyCheckpoints,
  },
};

export function getGuidedVideo(id) {
  const video = guidedVideoRegistry[id];
  return video?.status === 'development' || video?.status === 'published'
    ? video
    : null;
}

export function resolveGuidedRoute(route, pathname) {
  if (!route || typeof route !== 'string' || !route.startsWith('/')) return '';
  const token = pathname.match(/^\/portal\/([^/?#]+)/)?.[1];
  if (route.includes(':token') && !token) return '';
  return route.replace(
    ':token',
    token ? encodeURIComponent(decodeURIComponent(token)) : ''
  );
}
