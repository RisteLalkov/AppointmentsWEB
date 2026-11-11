(() => {
  "use strict";
  const trigger=document.querySelector('#clinic-switch-button'),dialog=document.querySelector('#clinic-switch-dialog');
  if(!trigger || !dialog) return;
  const tr=window.MedTerminI18n.t,content=document.querySelector('#clinic-switch-content');
  let request=0;
  async function load(){
    const current=++request;
    content.textContent=tr('Се вчитува…');
    try{
      const response=await fetch('/PatientClinics/Switcher',{headers:{'Accept':'text/html'},cache:'no-store'});
      if(current!==request || !dialog.open) return;
      if(response.status===401 || response.redirected){location.assign('/Account/Login?ReturnUrl=%2FWorkspace');return;}
      if(!response.ok)throw Error(tr('Клиниките не може да се вчитаат. Обидете се повторно.'));
      const markup=await response.text();
      if(current===request && dialog.open)content.innerHTML=markup;
    }catch(error){
      if(current!==request || !dialog.open)return;
      content.replaceChildren();const message=document.createElement('p');message.className='inline-error';message.setAttribute('role','alert');message.textContent=error.message;
      const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent=tr('Обиди се повторно');retry.onclick=load;content.append(message,retry);
    }
  }
  trigger.addEventListener('click',()=>{dialog.showModal();trigger.setAttribute('aria-expanded','true');load();});
  document.querySelector('#clinic-switch-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{request++;trigger.setAttribute('aria-expanded','false');trigger.focus();});
  dialog.addEventListener('submit',event=>{
    const form=event.target,button=form.querySelector('button[type=submit]');
    if(!button || button.disabled){event.preventDefault();return;}
    const dirty=[...document.forms].some(f=>!dialog.contains(f) && !f.matches('[data-language-form]') && window.MedTerminFormState?.isDirty(f));
    if(dirty && !confirm(tr('Промената на клиника ќе ги отфрли незачуваните податоци. Продолжи?'))){event.preventDefault();return;}
    button.disabled=true;button.setAttribute('aria-busy','true');
  });
})();
