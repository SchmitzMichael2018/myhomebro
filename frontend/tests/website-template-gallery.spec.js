import { test, expect } from '@playwright/test';
const origin = process.env.WEB_DESIGN_BASE_URL || 'https://www.myhomebro.com';
const ids = ['contractor-showcase','contractor-local','contractor-premium','restaurant-food','restaurant-local','restaurant-dining'];

test('gallery filters and design choices reach the contact-last quote',async({page})=>{
  await page.goto(`${origin}/webdesign`);
  await expect(page.locator('.wd-gallery-card')).toHaveCount(6);
  await page.getByRole('button',{name:'Restaurant websites',exact:true}).click();
  await expect(page.locator('.wd-gallery-card')).toHaveCount(3);
  await page.getByRole('link',{name:'Choose Dining Experience',exact:true}).click();
  await expect(page.getByLabel('Website design',{exact:true})).toHaveValue('restaurant-dining');
  await expect(page.getByRole('radio',{name:'Restaurant',exact:true})).toBeChecked();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
});

for(const id of ids){
  test(`${id} has working navigation and a safe demo inquiry`,async({page})=>{
    await page.setViewportSize({width:1280,height:900});
    await page.goto(`${origin}/static/webdesign-templates/demo.html?template=${id}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.demo-ribbon')).toContainText('FICTIONAL BUSINESS');
    await expect(page.locator('.demo-ribbon a')).toHaveAttribute('href',`${origin}/webdesign?template=${id}#quote`);
    const restaurant=id.startsWith('restaurant');
    await page.locator('nav a[href="#about"]').click();
    await expect(page.locator('.about-content')).toBeVisible();
    if(restaurant){
      await page.locator('nav a[href="#menu"]').click();
      await page.getByLabel('Search the menu').fill('lemonade');
      await expect(page.locator('.menu-item')).toHaveCount(1);
      await expect(page.locator('.menu-item')).toContainText('House lemonade');
      await page.getByLabel('Search the menu').fill('no-such-dish');
      await expect(page.getByText('No dishes match your search.',{exact:false})).toBeVisible();
    }else{
      await page.locator('nav a[href="#gallery"]').click();
      await page.getByRole('button',{name:'Remodeling',exact:true}).click();
      await expect(page.locator('.project-card')).toHaveCount(1);
    }
    await page.locator('nav a[href="#contact"]').click();
    await page.getByLabel('Your name').fill('Demo Visitor');
    await page.getByLabel('Email address').fill('visitor@example.com');
    await page.getByLabel(restaurant?'Tell us about your gathering':'Tell us about the project').fill('Fictional example for preview only.');
    await page.getByRole('button',{name:'Preview my demo brief'}).click();
    await expect(page.locator('#inquiry-result')).toContainText('No inquiry was sent.');
    await expect(page.locator('#inquiry-result a[href^="mailto:"]')).toHaveCount(0);
    await page.setViewportSize({width:375,height:812});
    await page.getByRole('button',{name:'Menu',exact:false}).click();
    await expect(page.locator('#navigation')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
