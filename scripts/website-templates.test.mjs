import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const templates=path.join(root,'frontend/public/webdesign-templates');
const script=path.join(root,'scripts/create-customer-website.mjs');
const ids=['contractor-showcase','contractor-local','contractor-premium','restaurant-food','restaurant-local','restaurant-dining'];

test('all six designs export to independent customer websites',()=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'mhb-websites-'));
  const layouts=new Set();
  for(const id of ids){
    const run=spawnSync(process.execPath,[script,id,id],{cwd,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const folder=path.join(cwd,'customer-sites',id);
    for(const file of ['index.html','site.config.js','site.js','styles.css','README.md'])assert.ok(fs.statSync(path.join(folder,file)).size>0);
    new vm.Script(fs.readFileSync(path.join(folder,'site.js'),'utf8'));
    const html=fs.readFileSync(path.join(folder,'index.html'),'utf8');
    assert.match(html,/noindex,nofollow/);
    assert.doesNotMatch(html,/\/static\//);
    const scope={window:{}};
    vm.runInNewContext(fs.readFileSync(path.join(folder,'site.config.js'),'utf8'),scope);
    const config=scope.window.websiteConfig;
    assert.equal(config.id,id);
    assert.equal(config.demo,true);
    assert.ok(config.about.includes(config.name));
    layouts.add(config.type+':'+config.layout);
    assert.doesNotMatch(fs.readFileSync(path.join(folder,'site.js'),'utf8'),/XMLHttpRequest|localStorage|sessionStorage/);
    assert.equal(config.menuFeedUrl, undefined, 'Default exports do not connect to a menu service unless requested');
  }
  assert.equal(layouts.size,6);
});

test('export refuses traversal, unknown templates, and overwriting existing customers',()=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'mhb-website-validation-'));
  for(const args of [['../escape','customer'],['contractor-showcase','../escape'],['unknown-template','customer']])assert.notEqual(spawnSync(process.execPath,[script,...args],{cwd}).status,0);
  assert.equal(spawnSync(process.execPath,[script,ids[0],'customer'],{cwd}).status,0);
  const config=path.join(cwd,'customer-sites/customer/site.config.js');
  const original=fs.readFileSync(config,'utf8');
  assert.notEqual(spawnSync(process.execPath,[script,ids[1],'customer'],{cwd}).status,0);
  assert.equal(fs.readFileSync(config,'utf8'),original);
});

test('demo loader rejects unknown IDs before requesting script paths',()=>{
  const scope={window:{},location:{search:'?template=../../private'},URLSearchParams,document:{getElementById:()=>({set textContent(value){scope.message=value;}}),createElement:()=>{throw new Error('Unknown templates must not create scripts');}}};
  vm.runInNewContext(fs.readFileSync(path.join(templates,'demo.js'),'utf8'),scope);
  assert.match(scope.message,/not available/);
});

test('configured business colors override shared page defaults',()=>{
  const scope={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(templates,'configs/restaurant-food.js'),'utf8'),scope);
  const properties={};
  const root={innerHTML:''};
  Object.assign(scope,{location:{hash:'',href:'https://example.com/'},URL,FormData,document:{getElementById:id=>id==='site'?root:null,body:{style:{setProperty:(name,value)=>{properties[name]=value;}},classList:{toggle(){}}},querySelector:()=>({addEventListener(){}})},});
  scope.window.addEventListener=()=>{};
  scope.window.scrollTo=()=>{};
  vm.runInNewContext(fs.readFileSync(path.join(templates,'site.js'),'utf8'),scope);
  assert.equal(properties['--ink'],'#542c23');
  assert.equal(properties['--accent'],'#b45335');
  assert.ok(root.innerHTML.includes('The Neighborhood Table'));
});
