// Literal-only translation: records must never be searched, rewritten or escaped twice.
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
let checks=0;
const check=(ok,label)=>{if(!ok)throw Error(label);checks++;console.log('PASS language '+label);};
for(const lang of ['mk','en']) {
 const dom=new JSDOM(`<!doctype html><html lang="${lang}"><body><form id="edit"><label for="pass">Password</label><input id="pass" type="password" required></form><form data-language-form><input name="returnUrl"></form></body></html>`,{runScripts:'outside-only',url:'http://localhost/Workspace?doctor=d1#availability'});
 const w=dom.window,d=w.document;
 try {
  for(const file of ['i18n/en.js','js/localization.js','js/icons.js','js/password-visibility.js','js/validation-mk.js','js/language.js'])w.eval(await readFile(new URL('../../src/Appointments.Web/wwwroot/'+file,import.meta.url),'utf8'));
  const {t,html}=w.MedTerminI18n;
  check(t(' Лекар ')===(lang==='en'?' Doctor ':' Лекар '),lang+' translates explicit labels and keeps spacing');
  check(t('Закажи во {0}','14:00')===(lang==='en'?'Book at 14:00':'Закажи во 14:00'),lang+' formats parameters');
  const patient='Преглед &lt;script&gt;alert(1)&lt;/script&gt;';
  check(html`<label>Пациент</label><strong>${patient}</strong>`===`<label>${lang==='en'?'Patient':'Пациент'}</label><strong>${patient}</strong>`,lang+' keeps interpolated data and escaping exactly intact');
  if(lang==='en') {
    const original=w.MedTerminEnglish['Пациент'];w.MedTerminEnglish['Пациент']='Patient & "<staff>"';
    check(html`<span title="Пациент">Пациент</span>`==='<span title="Patient &amp; &quot;&lt;staff&gt;&quot;">Patient &amp; &quot;&lt;staff&gt;&quot;</span>','English translations are escaped in HTML text and attributes');
    w.MedTerminEnglish['Пациент']=original;
  }
  check(t('Јован Нешковски')==='Јован Нешковски',lang+' does not transliterate names');
  check(!w.MedTerminIcons.icon('x" onload="alert(1)'),lang+' rejects invalid icon identifiers');
  const button=d.querySelector('.password-visibility-toggle');button.click();
  check(button.title===(lang==='en'?'Hide password':'Сокриј лозинка'),lang+' password visibility action is localized');
  d.querySelector('#pass').value='';d.querySelector('#pass').checkValidity();
  check(d.querySelector('#pass').validationMessage===(lang==='en'?'Complete this required field.':'Пополнете го ова задолжително поле.'),lang+' required validation is localized');
  const form=d.querySelector('[data-language-form]');
  d.querySelector('#pass').dispatchEvent(new w.Event('input',{bubbles:true}));
  let prompted='';w.confirm=message=>{prompted=message;return false;};
  check(!form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))&&prompted.includes(lang==='en'?'Unsaved changes':'Незачуваните'),lang+' protects dirty input before changing language');
  const edit=d.querySelector('#edit'),revision=w.MedTerminFormState.revision(edit);
  w.MedTerminFormState.saved(edit,revision);w.confirm=()=>{throw Error('Saved form must not warn');};
  check(form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})),lang+' successful saves clear unsaved-input warnings');
  d.querySelector('#pass').dispatchEvent(new w.Event('input',{bubbles:true}));
  w.MedTerminFormState.saved(edit,revision);w.confirm=()=>false;
  check(!form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})),lang+' edits made during a save remain protected');
  w.confirm=()=>true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  check(form.elements.returnUrl.value==='/Workspace?doctor=d1#availability',lang+' preserves selected screen, filters and fragment');
 }finally{w.close();}
}
console.log(`${checks}/${checks} language runtime checks passed.`);
