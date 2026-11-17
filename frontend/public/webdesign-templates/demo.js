(() => {
  const ids = ['contractor-showcase','contractor-local','contractor-premium','restaurant-food','restaurant-local','restaurant-dining'];
  const id = new URLSearchParams(location.search).get('template') || ids[0];
  const root = document.getElementById('site');
  if (!ids.includes(id)) { root.textContent = 'This template is not available. Return to the MyHomeBro web design gallery.'; return; }
  const load = src => new Promise((resolve,reject) => { const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script); });
  load(`configs/${id}.js`).then(()=>load('site.js')).catch(()=>{ root.textContent='The template could not load. Please refresh or return to the gallery.'; });
})();
