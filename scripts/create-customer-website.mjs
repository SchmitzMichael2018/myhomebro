import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/public/webdesign-templates');
const [id, customer, ...options] = process.argv.slice(2);
let menuFeedUrl = '';
if (options.length) {
  try {
    if (options.length !== 2 || options[0] !== '--menu-feed-url' || !String(id).startsWith('restaurant-')) throw new Error();
    const parsed = new URL(options[1]);
    if (parsed.protocol !== 'https:' || !['www.myhomebro.com', 'myhomebro.com'].includes(parsed.hostname) || !/^\/api\/projects\/public\/restaurant-menus\/[0-9a-f-]{36}\/$/i.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) throw new Error();
    menuFeedUrl = parsed.href;
  } catch {
    console.error('Use --menu-feed-url with the public MyHomeBro menu address from a restaurant dashboard.');
    process.exit(1);
  }
}
if (!/^[a-z]+(?:-[a-z]+)*$/.test(id || '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customer || '')) {
  console.error('Usage: node scripts/create-customer-website.mjs contractor-showcase bright-contracting');
  process.exit(1);
}
const config = path.join(source,'configs',id+'.js');
if (!fs.existsSync(config)) {console.error('Unknown template. Choose a design from the gallery.');process.exit(1);}
const destination = path.resolve('customer-sites',customer);
if (fs.existsSync(destination)) {console.error('Destination already exists; no files were overwritten.');process.exit(1);}
fs.mkdirSync(destination,{recursive:true});
for (const name of ['site.js','styles.css']) fs.copyFileSync(path.join(source,name),path.join(destination,name));
fs.copyFileSync(config,path.join(destination,'site.config.js'));
if (menuFeedUrl) fs.appendFileSync(path.join(destination,'site.config.js'), '\nwindow.websiteConfig.menuFeedUrl = ' + JSON.stringify(menuFeedUrl) + ';\n');
fs.writeFileSync(path.join(destination,'index.html'),`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="Website preview awaiting business content and launch review."><title>Customer Website Preview</title><link rel="stylesheet" href="styles.css"><script defer src="site.config.js"></script><script defer src="site.js"></script></head><body><div id="site">Loading website…</div><noscript>Enable JavaScript to view this website.</noscript></body></html>\n`);
fs.writeFileSync(path.join(destination,'README.md'),`# Customer website: ${customer}\n\nCreated from ${id}. This folder is independent of MyHomeBro.\n\n1. Edit site.config.js: replace all fictional business content, example menu prices, photos, contact information, and hours.\n2. Replace inspiration photos with owned or licensed assets, preferably in a local assets/ folder.\n3. Add optional valid https URLs for MyHomeBro, ordering, reservations, and directions. Never copy another contractor's referral code.\n4. Test every page, search/filter, mobile navigation, and inquiry preview. The default delivery method is a reviewed email link, not server submission.\n5. Keep demo: true during review. Set demo: false only when the customer approves final content.\n6. Update index.html title/description and robots policy for launch. Add customer privacy and legal information appropriate to the features used.\n7. Create a separate GitHub repository with the contents of this folder. Deploy as a static site; no build command or application server is required.\n8. Connect the customer's domain after review; preserve business email DNS records.\n\nDemo content is deliberately noindex. No customer inquiries are sent while demo is true.\n`);
if (menuFeedUrl) fs.appendFileSync(path.join(destination,'README.md'), '\n## Connected restaurant menu\n\nThis site uses the public MyHomeBro menu feed configured in site.config.js. The website files are independently hosted, while published menu content and photos load from MyHomeBro. The restaurant edits its menu in /webdesign/dashboard, saves a draft, and publishes when ready. New visits or page refreshes load the latest published menu without rebuilding this website. Draft edits are private. If the menu is offline or unreachable, the site displays an unavailable message rather than old sample dishes. Test this connection from the final customer domain before launch.\n');
console.log(`Created ${destination}. Customize site.config.js, then review before launch.`);
