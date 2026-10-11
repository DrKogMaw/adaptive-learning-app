export function mountAccount({getState,setState}) {
  const section=document.querySelector('#account-section');
  const panel=document.querySelector('#account-panel');
  const storageLabel=document.querySelector('#storage-label');
  section.hidden=false;
  document.querySelector('#milestone-label').textContent='Milestone 8';
  let user=null,consent=null,csrf=null,syncEnabled=false,syncTimer=null,syncing=false,dirty=false;
  const api=async (path,options={})=>{
    const response=await fetch(path,{credentials:'same-origin',...options});
    if(!response.ok){let detail='Request failed';try{const data=await response.json();detail=data.error||data.detail||data.title||detail;}catch{}throw new Error(`${detail} (${response.status})`);}
    return response.status===204?null:response.json();
  };
  const mutation=async (path,method,body)=>{
    if(!csrf) csrf=(await api('/api/auth/csrf')).token;
    return api(path,{method,headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  };
  const message=(value,error=false)=>{const target=panel.querySelector('#account-message');if(target){target.textContent=value;target.classList.toggle('error',error);}};
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const refresh=async()=>{
    try{user=await api('/api/auth/me');consent=await api('/api/consent');}
    catch{user=null;consent=null;syncEnabled=false;}
    render();
  };
  const render=()=>{
    storageLabel.textContent=syncEnabled?'Connected to your account database.':'Your progress stays in this browser until you connect it.';
    document.querySelector('#reset-button').textContent=syncEnabled?'Reset browser and account progress':'Reset my local progress';
    if(!user){
      panel.innerHTML='<p>Create an account or sign in to store your study record. Your current browser progress stays here until you choose to connect it.</p><form id="account-form" class="account-form"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="10" autocomplete="current-password" required></label><div class="account-actions"><button type="submit" name="action" value="login" class="primary-button">Sign in</button><button type="submit" name="action" value="register" class="quiet-button">Create account</button></div></form><p id="account-message" role="status"></p>';
      panel.querySelector('#account-form').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;const action=event.submitter?.value||'login';const email=form.querySelector('[name="email"]').value,password=form.querySelector('[name="password"]').value;
        try{if(action==='register')await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
          await api('/api/auth/login?useCookies=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
          csrf=null;form.reset();await refresh();}catch(error){message(error.message,true);}
      });
      return;
    }
    if(!consent?.active){
      panel.innerHTML=`<p>Signed in as <strong>${escape(user.email)}</strong>.</p><div class="consent-copy">${escape(consent?.text||'')}</div><label class="consent-choice"><input type="checkbox" id="consent-check"> I have read this and agree to save my study data.</label><div class="account-actions"><button id="accept-consent" class="primary-button" type="button">Accept and continue</button><button id="account-signout" class="quiet-button" type="button">Sign out</button></div><p id="account-message" role="status"></p>`;
      panel.querySelector('#accept-consent').addEventListener('click',async()=>{if(!panel.querySelector('#consent-check').checked){message('Please read the notice and check the box first.',true);return;}try{await mutation('/api/consent','POST',{version:consent.version,accepted:true});await refresh();}catch(error){message(error.message,true);}});
      panel.querySelector('#account-signout').addEventListener('click',signOut);
      return;
    }
    panel.innerHTML=`<p>Signed in as <strong>${escape(user.email)}</strong>. ${syncEnabled?'Changes in this browser now save to your account.':'Choose the starting copy of your progress.'}</p><div class="account-actions"><button id="upload-progress" class="primary-button" type="button">Use this browser’s progress</button><button id="load-progress" class="quiet-button" type="button">Load account progress</button><button id="export-progress" class="quiet-button" type="button">Export study progress</button></div><div class="account-actions secondary"><button id="withdraw-consent" type="button">Withdraw consent</button><button id="account-signout" type="button">Sign out</button><button id="delete-account" type="button">Delete account and data</button></div><p id="account-message" role="status">${syncEnabled?'Account sync is on.':'Your account is ready; browser data has not been copied yet.'}</p>`;
    panel.querySelector('#upload-progress').addEventListener('click',async()=>{try{const remote=await api('/api/progress');if((remote.attempts.length||remote.studySessions.length||remote.cognitiveSessions?.length||remote.recommendations?.length||remote.researchEvents?.length||Object.keys(remote.status).length)&&!confirm('Replace the account progress with this browser’s progress?'))return;await upload();syncEnabled=true;render();message('Browser progress saved. New changes will save automatically.');}catch(error){message(error.message,true);}});
    panel.querySelector('#load-progress').addEventListener('click',async()=>{try{const local=getState();if((local.attempts.length||local.studySessions.length||local.cognitiveSessions?.length||local.recommendations?.length||local.researchEvents?.length||Object.keys(local.status).length)&&!confirm('Replace this browser’s progress with the account progress?'))return;const remote=await api('/api/progress');setState(remote);syncEnabled=true;render();message('Account progress loaded. New changes will save automatically.');}catch(error){message(error.message,true);}});
    panel.querySelector('#export-progress').addEventListener('click',async()=>{try{const data=await api('/api/progress');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='nextstep-account-progress.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);message('Study progress exported.');}catch(error){message(error.message,true);}});
    panel.querySelector('#withdraw-consent').addEventListener('click',async()=>{if(!confirm('Withdraw consent? New study data will stop saving to your account. Existing data stays available for export or deletion.'))return;try{await mutation('/api/consent','DELETE');syncEnabled=false;await refresh();}catch(error){message(error.message,true);}});
    panel.querySelector('#account-signout').addEventListener('click',signOut);
    panel.querySelector('#delete-account').addEventListener('click',async()=>{if(!confirm('Delete your account and all its server-stored study data? This cannot be undone. Browser data will stay on this device.'))return;try{await mutation('/api/account','DELETE');user=null;consent=null;csrf=null;syncEnabled=false;render();}catch(error){message(error.message,true);}});
  };
  async function signOut(){try{await mutation('/api/auth/logout','POST');user=null;consent=null;csrf=null;syncEnabled=false;render();}catch(error){message(error.message,true);}}
  async function upload(){await mutation('/api/progress','PUT',getState());}
  async function flush(){if(!syncEnabled||syncing)return;syncing=true;dirty=false;try{await upload();message('Saved to your account.');}catch(error){message(`Account save failed: ${error.message}`,true);}finally{syncing=false;if(dirty)scheduleSync();}}
  function scheduleSync(){if(!syncEnabled)return;dirty=true;clearTimeout(syncTimer);syncTimer=setTimeout(flush,700);}
  refresh();
  return {scheduleSync,isSyncEnabled:()=>syncEnabled};
}
