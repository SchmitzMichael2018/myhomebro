export const WEBSITE_TEMPLATES = [
  { id: 'contractor-showcase', type: 'Contractor', name: 'Project Showcase', style: 'showcase', description: 'A split hero and photo-led project gallery for remodelers and renovation specialists.', business: 'Oak & Stone' },
  { id: 'contractor-local', type: 'Contractor', name: 'Local Service', style: 'local', description: 'Service-first navigation and a quick estimate path for repair and home service businesses.', business: 'Neighborly Home Services' },
  { id: 'contractor-premium', type: 'Contractor', name: 'Premium Builder', style: 'premium', description: 'An editorial headline, panoramic imagery, and project stories for custom builders.', business: 'Form & Field' },
  { id: 'restaurant-food', type: 'Restaurant', name: 'Food First', style: 'food', description: 'An image-first introduction with featured dishes and a searchable menu.', business: 'The Neighborhood Table' },
  { id: 'restaurant-local', type: 'Restaurant', name: 'Neighborhood Favorite', style: 'local', description: 'Menu, hours, location, and practical visit details near the top.', business: 'Corner Kitchen' },
  { id: 'restaurant-dining', type: 'Restaurant', name: 'Dining Experience', style: 'dining', description: 'A full-width atmosphere-led hero, restaurant story, and visit planning.', business: 'Juniper & Hearth' },
];

export function findWebsiteTemplate(id) {
  return WEBSITE_TEMPLATES.find(template => template.id === id) || null;
}

export function websiteTemplateDemoUrl(id) {
  return `/static/webdesign-templates/demo.html?template=${encodeURIComponent(id)}`;
}
