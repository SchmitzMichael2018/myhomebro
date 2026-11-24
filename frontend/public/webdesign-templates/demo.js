(() => {
  const ids = ['contractor-showcase','contractor-local','contractor-premium','restaurant-food','restaurant-local','restaurant-dining'];
  const id = new URLSearchParams(location.search).get('template') || ids[0];
  const root = document.getElementById('site');
  if (!ids.includes(id)) { root.textContent = 'This template is not available. Return to the MyHomeBro web design gallery.'; return; }
  const load = src => new Promise((resolve,reject) => { const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script); });
  load(`configs/${id}.js`).then(() => {
    const demo = window.websiteConfig;
    if (demo.type === 'restaurant') {
      demo.address = '24 Market Square, Bellwood (sample address)';
      demo.about = `${demo.name} is a neighborhood gathering place for a quick lunch, a slow dinner, or a table full of friends. Our menu brings familiar favorites together with seasonal specials.`;
      demo.catering = 'Planning a team lunch or a family celebration? Share your date, guest count, and dietary needs so we can help you plan the menu.';
    } else {
      demo.serviceArea = 'Bellwood and surrounding communities (sample service area)';
      demo.about = `${demo.name} helps homeowners plan renovations around the way they live. We start by listening, explain the options for your space, and agree on a clear scope before scheduling work.`;
      const services = [
        'We look at how you use the room, discuss layout and storage, and help you choose finishes that fit your budget.',
        'We consider lighting, storage, and daily routines when planning the layout and helping you compare materials.',
        'We review how you use the yard and talk through shade, access, and the finishes you want for the space.',
      ];
      if (demo.services[0]?.title === 'Kitchen renovations') {
        demo.services = demo.services.map((item, index) => ({ ...item, details: services[index] || item.details }));
      }
    }
    return load('site.js');
  }).catch(() => {
    root.textContent = 'The template could not load. Please refresh or return to the gallery.';
  });
})();
