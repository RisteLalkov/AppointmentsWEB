import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../../src/Appointments.Web/wwwroot/js/theme.js', import.meta.url), 'utf8');
let checks=0;
function check(ok,name){if(!ok)throw Error(name);checks++;console.log('PASS theme '+name);}
function fixture(value,blocked=false){
 const dom=new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#176c60"></head><body><div data-theme-picker hidden><select data-theme-select><option value="default">Default</option><option value="dark">Dark</option><option value="vibrant">Vibrant</option></select></div></body></html>',{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window;
 if(blocked)Object.defineProperty(w,'localStorage',{get(){throw new Error('Blocked storage');}});
 else if(value!==undefined)w.localStorage.setItem('medtermin.theme',value);
 w.eval(script);
 return {dom,w,d:w.document};
}
for(const [stored,expected] of [[undefined,'default'],['dark','dark'],['vibrant','vibrant'],['invalid','default']]){
 const {w,d}=fixture(stored);try{
  check(d.documentElement.dataset.theme===expected,'Stored '+stored+' applied before DOM ready');
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  check(!d.querySelector('[data-theme-picker]').hidden&&d.querySelector('select').value===expected,'Control initialized for '+expected);
 }finally{w.close();}
}
const {w,d}=fixture();try{
 d.dispatchEvent(new w.Event('DOMContentLoaded'));
 const select=d.querySelector('select');select.value='dark';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 check(w.localStorage.getItem('medtermin.theme')==='dark'&&d.documentElement.dataset.theme==='dark','Selection persists without a page reload');
 check(d.querySelector('meta').content==='#354b4e','Browser chrome follows chosen theme');
 w.dispatchEvent(new w.StorageEvent('storage',{key:'medtermin.theme',newValue:'vibrant'}));
 check(select.value==='vibrant'&&d.documentElement.dataset.theme==='vibrant','Other-tab changes synchronize');
 w.dispatchEvent(new w.StorageEvent('storage',{key:'medtermin.theme',newValue:'untrusted'}));
 check(select.value==='default','Invalid other-tab values cannot select an arbitrary theme');
 w.dispatchEvent(new w.StorageEvent('storage',{key:null,newValue:null}));
 check(d.documentElement.dataset.theme==='default','Clearing storage restores default');
}finally{w.close();}
const blocked=fixture(undefined,true);try{
 blocked.d.dispatchEvent(new blocked.w.Event('DOMContentLoaded'));
 const select=blocked.d.querySelector('select');select.value='dark';select.dispatchEvent(new blocked.w.Event('change',{bubbles:true}));
 check(blocked.d.documentElement.dataset.theme==='dark','Blocked browser storage does not break switching');
}finally{blocked.w.close();}
console.log(`${checks}/${checks} theme preference checks passed.`);
