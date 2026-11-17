const base = {
  type: 'contractor',
  demo: true,
  name: 'Oak & Stone',
  descriptor: 'Construction & Remodeling',
  tagline: 'Thoughtful spaces. Lasting craftsmanship.',
  headline: 'A home that feels more like you.',
  introduction: 'From the kitchen everyone gathers in to the patio where the day slows down. Bring your next home improvement into focus.',
  colors: { ink: '#233c32', accent: '#d9ad6b', paper: '#f7f5ef' },
  monogram: 'O&S',
  email: '',
  phone: '',
  serviceArea: 'Your city & surrounding communities',
  about: 'Oak & Stone is a fictional remodeling business created to demonstrate this website template. Replace this story with your background, approach, qualifications, and the people behind your business.',
  heroImage: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85',
  heroAlt: 'Light-filled living room with natural materials and warm neutral furniture',
  services: [
    { title: 'Kitchen renovations', description: 'Plan a kitchen around how you cook, gather, and live.', details: 'Use this page to describe your kitchen services, planning process, and what customers should prepare before requesting an estimate.' },
    { title: 'Bathroom remodeling', description: 'Make everyday routines feel a little more considered.', details: 'Explain the bathroom work you offer, how you coordinate qualified trades, and the decisions customers will make about layout and finishes.' },
    { title: 'Outdoor living', description: 'Create a comfortable place to spend more time outside.', details: 'Describe your patio, deck, or outdoor improvement services. Add accurate information about site visits, approvals, and project planning.' },
  ],
  projects: [
    { title: 'A brighter gathering place', category: 'Interiors', image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=80', alt: 'Airy living room with a sofa and natural textures', description: 'Illustrative interior inspiration. Replace with a real project and photos you have permission to publish.' },
    { title: 'Room to make it your own', category: 'Interiors', image: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=80', alt: 'Contemporary home interior with warm furnishings', description: 'Example project layout for your scope, materials, and finished result.' },
    { title: 'Spaces for everyday living', category: 'Remodeling', image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1000&q=80', alt: 'Modern residential interior', description: 'Inspiration image, not work performed by this fictional business.' },
  ],
  process: ['Tell us about the project', 'Review the scope and estimate', 'Agree on the work and schedule', 'Build, review, and enjoy'],
  myhomebro: { projectUrl: '', referralUrl: '', qrImage: '' },
};

window.websiteConfig = {...base, ...{
  "id": "contractor-local",
  "type": "contractor",
  "layout": "local",
  "templateName": "Local Service",
  "name": "Neighborly Home Services",
  "monogram": "NH",
  "headline": "Your home to-do list. Handled.",
  "descriptor": "Repairs, improvements & everyday projects",
  "colors": {
    "ink": "#173e4b",
    "accent": "#e1b454",
    "paper": "#f3f7f6"
  }
}};

window.websiteConfig.about = window.websiteConfig.about.replace(base.name, window.websiteConfig.name);
