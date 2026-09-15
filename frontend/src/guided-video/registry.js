import createProfileVideo from '../assets/how-to/myhomebro-create-profile-howto.mp4';
import createProfilePoster from '../assets/how-to/myhomebro-create-profile-howto-poster.jpg';
import createProfileCaptions from '../assets/how-to/myhomebro-create-profile-howto.vtt';
import connectStripeVideo from '../assets/how-to/myhomebro-connect-stripe-howto.mp4';
import connectStripePoster from '../assets/how-to/myhomebro-connect-stripe-howto-poster.jpg';
import connectStripeCaptions from '../assets/how-to/myhomebro-connect-stripe-howto.vtt';
import customerOverviewVideo from '../assets/product-overview/myhomebro-homeowner-walkthrough.mp4?url';
import customerOverviewPoster from '../assets/product-overview/myhomebro-homeowner-walkthrough-poster.jpg?url';
import customerOverviewCaptions from '../assets/product-overview/myhomebro-homeowner-walkthrough.vtt?no-inline';
import propertyManagerOverviewVideo from '../assets/product-overview/myhomebro-property-manager-walkthrough.mp4?url';
import propertyManagerOverviewPoster from '../assets/product-overview/myhomebro-property-manager-walkthrough-poster.jpg?url';
import propertyManagerOverviewCaptions from '../assets/product-overview/myhomebro-property-manager-walkthrough.vtt?no-inline';

const howToCheckpoint = (
  id,
  time,
  title,
  instruction,
  actionLabel,
  actionRoute
) => ({
  id,
  time,
  title,
  instruction,
  actionLabel,
  actionRoute,
  pauseInWatchAndDo: true,
  completion: { type: 'manual-acknowledgement' },
});

const profileCheckpoints = [
  howToCheckpoint(
    'profile-account',
    9,
    'Create your account',
    'Use contact information you control, create a strong password, and review the terms.',
    'Open onboarding',
    '/app/onboarding'
  ),
  howToCheckpoint(
    'profile-services',
    30,
    'Describe your services',
    'Include the trades and project types that accurately describe your work.',
    'Continue onboarding',
    '/app/onboarding'
  ),
  howToCheckpoint(
    'profile-review',
    52,
    'Review your suggested setup',
    'Confirm the workflow and defaults before accepting them.',
    'Review setup',
    '/app/onboarding'
  ),
];

const stripeCheckpoints = [
  howToCheckpoint(
    'stripe-open',
    9,
    'Open secure Stripe setup',
    'Stripe collects the business, identity, and payout details required for payment processing.',
    'Open Stripe onboarding',
    '/app/onboarding/stripe'
  ),
  howToCheckpoint(
    'stripe-verify',
    19,
    'Use accurate information',
    'Enter real legal, identity, and bank details. Never use fictional information in live mode.',
    'Continue Stripe setup',
    '/app/onboarding/stripe'
  ),
  howToCheckpoint(
    'stripe-status',
    40,
    'Confirm payment readiness',
    'Verify that charges and payouts are enabled and complete any remaining Stripe requirements.',
    'Check Stripe status',
    '/app/onboarding/stripe'
  ),
];

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
  'property-manager-portal-overview': {
    id: 'property-manager-portal-overview',
    title: 'Your Property Manager Portal Overview',
    summary:
      'See how to manage resident requests, coordinate vendors, track work, and preserve property records.',
    audience: ['property_manager'],
    category: 'Getting started',
    workspace: 'Property Manager Portal',
    duration: 133,
    videoSource: propertyManagerOverviewVideo,
    poster: propertyManagerOverviewPoster,
    captionsSource: propertyManagerOverviewCaptions,
    transcript: [
      {
        time: 0,
        title: 'Welcome',
        text: 'See how MyHomeBro supports maintenance work across properties and units.',
      },
      {
        time: 24,
        title: 'Capture maintenance needs',
        text: 'Collect resident requests and the property details needed for review.',
      },
      {
        time: 50,
        title: 'Coordinate the work',
        text: 'Route approved work to internal staff, preferred vendors, or participating marketplace contractors.',
      },
      {
        time: 82,
        title: 'Track completion',
        text: 'Follow progress, documentation, approvals, and authorized payment activity.',
      },
      {
        time: 110,
        title: 'Preserve property history',
        text: 'Keep maintenance, equipment, warranty, vendor, and unit records together.',
      },
    ],
    defaultRoute: '/portal/:token?workspace=overview',
    status: 'published',
    version: 1,
    updatedDate: '2026-09-15',
    placeholder: false,
    checkpoints: [],
  },
  'customer-portal-overview': {
    id: 'customer-portal-overview',
    title: 'Your Customer Portal Overview',
    summary:
      'See how to review estimates and agreements, follow progress, manage payments, and keep project records together.',
    audience: ['customer', 'homeowner'],
    category: 'Getting started',
    workspace: 'Customer Portal',
    duration: 99,
    videoSource: customerOverviewVideo,
    poster: customerOverviewPoster,
    captionsSource: customerOverviewCaptions,
    transcript: [
      {
        time: 0,
        title: 'Welcome',
        text: 'See how MyHomeBro keeps your project organized from the first request through closeout.',
      },
      {
        time: 18,
        title: 'Review project options',
        text: 'Use your portal to review project requests, estimates, and contractor details.',
      },
      {
        time: 39,
        title: 'Approve the agreement',
        text: 'Review the scope, schedule, milestones, and payment terms before approval.',
      },
      {
        time: 58,
        title: 'Follow progress and payments',
        text: 'Track milestone updates and use the payment option defined for the project.',
      },
      {
        time: 78,
        title: 'Keep your records',
        text: 'Retain project documents, receipts, photos, and warranties in one place.',
      },
    ],
    defaultRoute: '/portal/:token?workspace=overview',
    status: 'published',
    version: 1,
    updatedDate: '2026-09-15',
    placeholder: false,
    checkpoints: [],
  },
  'create-contractor-profile': {
    id: 'create-contractor-profile',
    title: 'Create Your Contractor Profile',
    summary:
      'Create your account, describe your services, and review the suggested business setup.',
    audience: ['contractor'],
    category: 'Onboarding',
    workspace: 'Company Setup',
    duration: 71,
    videoSource: createProfileVideo,
    poster: createProfilePoster,
    captionsSource: createProfileCaptions,
    transcript: [
      {
        time: 0,
        title: 'Welcome',
        text: 'Create your contractor account and initial business profile.',
      },
      {
        time: 9,
        title: 'Create your account',
        text: 'Enter accurate contact information and review the terms.',
      },
      {
        time: 21,
        title: 'Start your setup',
        text: 'Use onboarding to prepare editable business defaults.',
      },
      {
        time: 30,
        title: 'Describe your services',
        text: 'Describe your trades and common project types.',
      },
      {
        time: 40,
        title: 'Confirm business details',
        text: 'Review your service area and operating details.',
      },
      {
        time: 52,
        title: 'Review before accepting',
        text: 'Confirm the suggested workflow and project defaults.',
      },
      {
        time: 61,
        title: 'Profile ready',
        text: 'Return to Profile whenever your business information changes.',
      },
    ],
    defaultRoute: '/app/onboarding',
    status: 'published',
    version: 1,
    updatedDate: '2026-09-15',
    placeholder: false,
    checkpoints: profileCheckpoints,
  },
  'connect-stripe-and-get-paid': {
    id: 'connect-stripe-and-get-paid',
    title: 'Connect Stripe and Get Paid',
    summary:
      'Securely verify your business and enable eligible payments and payouts.',
    audience: ['contractor'],
    category: 'Onboarding',
    workspace: 'Payments',
    duration: 62,
    videoSource: connectStripeVideo,
    poster: connectStripePoster,
    captionsSource: connectStripeCaptions,
    transcript: [
      {
        time: 0,
        title: 'Welcome',
        text: 'Connect Stripe to accept customer payments and receive payouts.',
      },
      {
        time: 9,
        title: 'Open payment setup',
        text: 'Start secure Stripe onboarding from MyHomeBro.',
      },
      {
        time: 19,
        title: 'Use accurate information',
        text: 'Verify the real person and business.',
      },
      {
        time: 30,
        title: 'Review before submitting',
        text: 'Keep sensitive information inside the Stripe component.',
      },
      {
        time: 40,
        title: 'Confirm payment readiness',
        text: 'Check that charges and payouts are enabled.',
      },
      {
        time: 52,
        title: 'Stripe connected',
        text: 'Eligible payment workflows are now available.',
      },
    ],
    defaultRoute: '/app/onboarding/stripe',
    status: 'published',
    version: 1,
    updatedDate: '2026-09-15',
    placeholder: false,
    checkpoints: stripeCheckpoints,
  },
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

export function listGuidedVideosForAudience(audience) {
  return Object.values(guidedVideoRegistry).filter(
    (video) => video.status === 'published' && video.audience.includes(audience)
  );
}

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
