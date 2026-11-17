const base = {
  type: 'restaurant',
  demo: true,
  name: 'The Neighborhood Table',
  descriptor: 'Local kitchen. Good company.',
  tagline: 'Come hungry. Stay a little longer.',
  headline: 'Good food. Your favorite people.',
  introduction: 'A place for the familiar favorites, the extra side to share, and the conversations that run past dessert.',
  colors: { ink: '#542c23', accent: '#b45335', paper: '#fcf6e9' },
  monogram: 'NT',
  email: '',
  phone: '',
  address: 'Your street address, city, state ZIP',
  mapUrl: '',
  orderingUrl: '',
  reservationUrl: '',
  about: 'The Neighborhood Table is a fictional restaurant created to demonstrate this website template. Tell your own story here: the food you love, the people who make it, and what makes your place feel like home.',
  heroImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1800&q=85',
  heroAlt: 'Warm restaurant dining room with wood tables and hanging lights',
  foodImage: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1100&q=80',
  hours: [ ['Monday', 'Closed'], ['Tuesday–Thursday', '11 am – 9 pm'], ['Friday–Saturday', '11 am – 10 pm'], ['Sunday', '11 am – 8 pm'] ],
  menu: [
    { category: 'To start', name: 'Roasted tomato soup', description: 'Slow-roasted tomato, basil, toasted sourdough.', price: '$8', tags: ['Vegetarian'] },
    { category: 'To start', name: 'Crispy garden bites', description: 'Seasonal vegetables, herb dipping sauce.', price: '$10', tags: ['Vegetarian'] },
    { category: 'The favorites', name: 'The neighborhood burger', description: 'Beef patty, cheddar, lettuce, tomato, house sauce. Served with fries.', price: '$17', tags: [] },
    { category: 'The favorites', name: 'Sunday chicken sandwich', description: 'Crispy chicken, pickles, slaw, soft bun.', price: '$16', tags: [] },
    { category: 'The favorites', name: 'Garden grain bowl', description: 'Roasted vegetables, grains, greens, lemon dressing.', price: '$15', tags: ['Vegetarian'] },
    { category: 'Something sweet', name: 'Warm apple crumble', description: 'Cinnamon apples, oat crumble, vanilla ice cream.', price: '$9', tags: ['Vegetarian'] },
    { category: 'Drinks', name: 'House lemonade', description: 'Fresh lemon and a little sweetness.', price: '$4', tags: [] },
    { category: 'Drinks', name: 'Fresh brewed iced tea', description: 'Sweet or unsweetened.', price: '$3', tags: [] },
  ],
  catering: 'From a working lunch to a family celebration, tell us about your gathering. Replace this example with your catering options, minimums, lead times, and service area.',
};

window.websiteConfig = {...base, ...{
  "id": "restaurant-food",
  "type": "restaurant",
  "layout": "food",
  "templateName": "Food First",
  "name": "The Neighborhood Table"
}};

window.websiteConfig.about = window.websiteConfig.about.replace(base.name, window.websiteConfig.name);
