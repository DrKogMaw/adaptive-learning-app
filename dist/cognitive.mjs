export async function loadCognitiveConfig(url='./cognitive-config.json') {
  const response=await fetch(url);
  if(!response.ok) throw new Error('Could not load cognitive task configuration');
  return response.json();
}

function seededRandom(seed) {
  let value=seed>>>0;
  return () => {value^=value<<13;value^=value>>>17;value^=value<<5;return (value>>>0)/4294967296;};
}
function shuffle(values,random) {
  const result=[...values];
  for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function createCognitivePlan(seed) {
  const random=seededRandom(seed);
  const vigilance=Array.from({length:12},()=>({foreperiodMs:1200+Math.floor(random()*1201)}));
  const spans=shuffle([3,3,4,4,5,5,6,6],random);
  const digitBackward=spans.map(length=>{let digits='';while(digits.length<length){const next=String(1+Math.floor(random()*9));if(next!==digits.at(-1))digits+=next;}return {digits};});
  const flanker=shuffle(['congruent','incongruent'].flatMap(condition=>['left','right'].flatMap(target=>Array.from({length:5},()=>({target,flankers:condition==='congruent'?target:target==='left'?'right':'left',condition})))),random);
  const transitions=shuffle([...Array(11).fill('switch'),...Array(12).fill('repeat')],random);
  const numbers=[1,2,3,4,6,7,8,9];
  let rule=random()<.5?'parity':'magnitude';
  const taskSwitch=Array.from({length:24},(_,index)=>{
    const condition=index===0?'first':transitions[index-1];
    if(condition==='switch')rule=rule==='parity'?'magnitude':'parity';
    const desired=index%2===0?'left':'right';
    const candidates=numbers.filter(number=>rule==='parity'?(desired==='left'?number%2===1:number%2===0):(desired==='left'?number<5:number>5));
    return {rule,number:candidates[Math.floor(random()*candidates.length)],condition};
  });
  return {vigilance,digitBackward,flanker,taskSwitch};
}

const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const percent=(items)=>items.length?Math.round(100*items.filter(x=>x.isCorrect).length/items.length):null;
export function summarizeCognitive(session) {
  const by=type=>session.trials.filter(t=>t.taskType===type);
  const vigilance=by('vigilance'),digits=by('digit-backward'),flanker=by('flanker'),switches=by('task-switch');
  const correctRt=items=>items.filter(t=>t.isCorrect&&Number.isFinite(t.responseTimeMs)).map(t=>t.responseTimeMs);
  const flankerCongruent=correctRt(flanker.filter(t=>t.condition==='congruent'));
  const flankerIncongruent=correctRt(flanker.filter(t=>t.condition==='incongruent'));
  const switchRepeat=correctRt(switches.filter(t=>t.condition==='repeat'));
  const switchActual=correctRt(switches.filter(t=>t.condition==='switch'));
  const difference=(a,b)=>a.length>=3&&b.length>=3?Math.round(median(a)-median(b)):null;
  return {
    vigilanceMedianMs:median(correctRt(vigilance)),
    vigilanceLapses:vigilance.filter(t=>t.response.action==='timeout'||(t.responseTimeMs??0)>=500).length,
    vigilanceFalseStarts:vigilance.filter(t=>t.response.action==='false-start').length,
    digitAccuracy:percent(digits),
    digitMaxSpan:Math.max(0,...digits.filter(t=>t.isCorrect).map(t=>t.stimulus.digits.length)),
    flankerAccuracy:percent(flanker),
    flankerInterferenceMs:difference(flankerIncongruent,flankerCongruent),
    switchAccuracy:percent(switches),
    switchCostMs:difference(switchActual,switchRepeat)
  };
}
export function referenceFor(sessions,currentIndex,config) {
  const comparable=sessions.filter(s=>s.batteryVersion===config.batteryVersion).sort((a,b)=>Date.parse(a.completedAt)-Date.parse(b.completedAt));
  const phase=currentIndex<config.baseline.practiceRuns?'practice':currentIndex<config.baseline.practiceRuns+config.baseline.referenceRuns?'building':'comparison';
  if(phase!=='comparison')return {phase,reference:null};
  const referenceSessions=comparable.slice(config.baseline.practiceRuns,config.baseline.practiceRuns+config.baseline.referenceRuns);
  if(referenceSessions.length<config.baseline.referenceRuns)return {phase:'building',reference:null};
  const summaries=referenceSessions.map(summarizeCognitive),reference={};
  for(const key of Object.keys(summaries[0]))reference[key]=median(summaries.map(x=>x[key]));
  return {phase,reference};
}

export async function mountCognitive({getSessions,addSession}) {
  const config=await loadCognitiveConfig();
  const panel=document.querySelector('#cognitive-panel'),dialog=document.querySelector('#cognitive-dialog'),content=document.querySelector('#cognitive-content');
  let controller=null,running=false;
  dialog.addEventListener('cancel',()=>controller?.abort());
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const formatMetric=(value,unit)=>value==null?'—':`${Math.round(value)}${unit}`;
  const taskConfig=type=>config.tasks.find(task=>task.type===type);
  const render=()=>{
    const sessions=getSessions().filter(s=>s.batteryVersion===config.batteryVersion).sort((a,b)=>Date.parse(a.completedAt)-Date.parse(b.completedAt));
    const count=sessions.length;
    const phase=count===0?'Run 1 is practice':count===1?'Run 2 builds your reference':count===2?'Run 3 completes your reference':'Compare with your own reference';
    const latest=sessions.at(-1),metrics=latest&&summarizeCognitive(latest);
    panel.innerHTML=`<div class="cognitive-intro"><div><strong>${escape(phase)}</strong><p>Four short tasks plus a state questionnaire. Keep this tab visible; an interrupted run must restart. Results are descriptive and do not change topic recommendations.</p></div><button class="primary-button" id="start-cognitive" type="button">${count?'Run again':'Start assessment'}</button></div>${latest?`<div class="cognitive-results"><div><span>Latest run</span><strong>${escape(fmtDate(latest.completedAt))}</strong></div><div><span>Response speed</span><strong>${formatMetric(metrics.vigilanceMedianMs,' ms')}</strong></div><div><span>Backward recall</span><strong>${formatMetric(metrics.digitAccuracy,'%')}</strong></div><div><span>Flanker choices</span><strong>${formatMetric(metrics.flankerAccuracy,'%')}</strong></div><div><span>Rule switching</span><strong>${formatMetric(metrics.switchAccuracy,'%')}</strong></div></div><button class="text-link cognitive-details" id="cognitive-details" type="button">View latest details ↗</button>`:''}`;
    panel.querySelector('#start-cognitive').addEventListener('click',start);
    panel.querySelector('#cognitive-details')?.addEventListener('click',()=>showResult(latest,sessions));
  };
  const frame=(label,body)=>{content.innerHTML=`<div class="dialog-body cognitive-body"><button class="dialog-close" id="cognitive-close" type="button" aria-label="Close assessment">×</button><p class="eyebrow">${escape(label)}</p>${body}</div>`;content.querySelector('#cognitive-close').addEventListener('click',()=>{controller?.abort();dialog.close();});};
  const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(new DOMException('Aborted','AbortError'));const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});});
  const nextButton=(signal)=>new Promise((resolve,reject)=>{const button=content.querySelector('#cognitive-next');const abort=()=>{button.removeEventListener('click',done);reject(new DOMException('Aborted','AbortError'));};const done=()=>{signal.removeEventListener('abort',abort);resolve();};button.addEventListener('click',done,{once:true});signal.addEventListener('abort',abort,{once:true});});
  const intro=async(label,title,body,signal)=>{frame(label,`<h2 id="cognitive-title">${escape(title)}</h2><p>${body}</p><button class="primary-button" id="cognitive-next" type="button">Continue</button>`);await nextButton(signal);};
  const resultTrial=(type,index,condition,stimulus,response,isCorrect,responseTimeMs,presentedAt,respondedAt)=>({id:crypto.randomUUID(),taskType:type,taskVersion:taskConfig(type).version,trialIndex:index,condition,stimulus,response,isCorrect,responseTimeMs,presentedAt,respondedAt});
  function vigilanceTrial(stimulus,index,signal){
    frame('TASK 1 · RESPONSE SPEED',`<h2 id="cognitive-title">Wait for the star</h2><p>Tap or press Space only when the star appears. ${index+1} of 12</p><button class="cognitive-target waiting" id="target-button" type="button">WAIT</button>`);
    const button=content.querySelector('#target-button');
    return new Promise((resolve,reject)=>{
      let appeared=false,done=false,started=performance.now(),presentedAt=new Date().toISOString(),targetAt=0,targetTimer,deadline;
      const cleanup=()=>{clearTimeout(targetTimer);clearTimeout(deadline);button.removeEventListener('click',tap);window.removeEventListener('keydown',key);signal.removeEventListener('abort',abort);};
      const finish=(action)=>{if(done)return;done=true;const respondedAt=action==='timeout'?null:new Date().toISOString();const responseTimeMs=action==='tap'?Math.round(performance.now()-targetAt):null;cleanup();resolve(resultTrial('vigilance',index,'target',stimulus,{action},action==='tap',responseTimeMs,presentedAt,respondedAt));};
      const tap=()=>finish(appeared?'tap':'false-start');
      const key=event=>{if(event.code==='Space'){event.preventDefault();tap();}};
      const abort=()=>{if(done)return;done=true;cleanup();reject(new DOMException('Aborted','AbortError'));};
      button.addEventListener('click',tap);window.addEventListener('keydown',key);signal.addEventListener('abort',abort,{once:true});
      targetTimer=setTimeout(()=>{if(done)return;appeared=true;targetAt=performance.now();presentedAt=new Date().toISOString();button.textContent='✳ TAP NOW';button.classList.remove('waiting');deadline=setTimeout(()=>finish('timeout'),2000);},stimulus.foreperiodMs);
    });
  }
  async function digitTrial(stimulus,index,signal){
    for(const digit of stimulus.digits){frame('TASK 2 · BACKWARD RECALL',`<h2 id="cognitive-title">Remember the digits</h2><div class="cognitive-digit">${digit}</div><p>Sequence ${index+1} of 8</p>`);await sleep(850,signal);frame('TASK 2 · BACKWARD RECALL','<h2 id="cognitive-title">Remember the digits</h2><div class="cognitive-digit">·</div>');await sleep(180,signal);}
    frame('TASK 2 · BACKWARD RECALL',`<h2 id="cognitive-title">Enter them backward</h2><p>Sequence ${index+1} of 8. Type the digits in reverse order.</p><form id="digit-form" class="digit-form"><input id="digit-answer" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" aria-label="Digits in reverse order" required><button class="primary-button" type="submit">Submit</button></form>`);
    const form=content.querySelector('#digit-form'),input=content.querySelector('#digit-answer');input.focus();
    const presentedAt=new Date().toISOString(),started=performance.now();
    return new Promise((resolve,reject)=>{let done=false;const cleanup=()=>{clearTimeout(timeout);form.removeEventListener('submit',submit);signal.removeEventListener('abort',abort);};const finish=entered=>{if(done)return;done=true;const respondedAt=new Date().toISOString(),rt=Math.round(performance.now()-started);cleanup();resolve(resultTrial('digit-backward',index,`length-${stimulus.digits.length}`,stimulus,{entered},entered===stimulus.digits.split('').reverse().join(''),rt,presentedAt,respondedAt));};const submit=event=>{event.preventDefault();finish(input.value.replace(/\D/g,''));};const abort=()=>{if(done)return;done=true;cleanup();reject(new DOMException('Aborted','AbortError'));};const timeout=setTimeout(()=>finish(''),20000);form.addEventListener('submit',submit);signal.addEventListener('abort',abort,{once:true});});
  }
  function choiceTrial(type,stimulus,index,condition,signal){
    const isFlanker=type==='flanker';
    const arrow=side=>side==='left'?'←':'→';
    const display=isFlanker?`${arrow(stimulus.flankers)}${arrow(stimulus.flankers)}${arrow(stimulus.target)}${arrow(stimulus.flankers)}${arrow(stimulus.flankers)}`:stimulus.number;
    const cue=isFlanker?'Choose the CENTER arrow':stimulus.rule==='parity'?'ODD → Left · EVEN → Right':'LESS THAN 5 → Left · GREATER THAN 5 → Right';
    const label=isFlanker?'TASK 3 · DISTRACTION':'TASK 4 · RULE SWITCHING';
    frame(label,`<h2 id="cognitive-title">${escape(cue)}</h2><div class="cognitive-stimulus">${display}</div><p>${index+1} of ${isFlanker?20:24}. Use the arrow keys or buttons.</p><div class="cognitive-choices"><button id="choice-left" type="button">← Left</button><button id="choice-right" type="button">Right →</button></div>`);
    const presentedAt=new Date().toISOString(),started=performance.now();
    return new Promise((resolve,reject)=>{let done=false;const left=content.querySelector('#choice-left'),right=content.querySelector('#choice-right');const cleanup=()=>{clearTimeout(timeout);left.removeEventListener('click',onLeft);right.removeEventListener('click',onRight);window.removeEventListener('keydown',key);signal.removeEventListener('abort',abort);};const finish=choice=>{if(done)return;done=true;const respondedAt=choice==='timeout'?null:new Date().toISOString(),rt=choice==='timeout'?null:Math.round(performance.now()-started);cleanup();const expected=isFlanker?stimulus.target:stimulus.rule==='parity'?(stimulus.number%2?'left':'right'):(stimulus.number<5?'left':'right');resolve(resultTrial(type,index,condition,isFlanker?{target:stimulus.target,flankers:stimulus.flankers}:{rule:stimulus.rule,number:stimulus.number},{choice},choice===expected,rt,presentedAt,respondedAt));};const onLeft=()=>finish('left'),onRight=()=>finish('right');const key=event=>{if(event.key==='ArrowLeft'){event.preventDefault();onLeft();}if(event.key==='ArrowRight'){event.preventDefault();onRight();}};const abort=()=>{if(done)return;done=true;cleanup();reject(new DOMException('Aborted','AbortError'));};const timeout=setTimeout(()=>finish('timeout'),3000);left.addEventListener('click',onLeft);right.addEventListener('click',onRight);window.addEventListener('keydown',key);signal.addEventListener('abort',abort,{once:true});});
  }
  const questionnaire=(signal)=>new Promise((resolve,reject)=>{
    frame('LAST STEP · STATE QUESTIONNAIRE',`<h2 id="cognitive-title">How are you feeling right now?</h2><p>These answers give context to this run. They are not a health assessment.</p><form id="state-form" class="state-form"><label>Sleepiness <small>1 = alert · 5 = very sleepy</small><select name="sleepiness" required><option value="">Choose</option>${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Motivation to study <small>1 = low · 5 = high</small><select name="motivation" required><option value="">Choose</option>${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Stress right now <small>1 = low · 5 = high</small><select name="stress" required><option value="">Choose</option>${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Sleep last night <small>Approximate hours</small><input name="sleepHours" type="number" min="0" max="16" step="1" required></label><label>Study in the last 24 hours <small>Approximate minutes</small><input name="recentStudyMinutes" type="number" min="0" max="240" step="1" required></label><label>Time available to study now<select name="availableMinutes" required><option value="">Choose</option><option value="15">15 minutes</option><option value="25">25 minutes</option><option value="45">45 minutes</option></select></label><button class="primary-button" type="submit">Save assessment</button></form>`);
    const form=content.querySelector('#state-form');const abort=()=>{form.removeEventListener('submit',submit);reject(new DOMException('Aborted','AbortError'));};const submit=event=>{event.preventDefault();signal.removeEventListener('abort',abort);const data=new FormData(form),responses=Object.fromEntries([...data].map(([key,value])=>[key,Number(value)]));resolve({id:crypto.randomUUID(),version:config.questionnaireVersion,responses,completedAt:new Date().toISOString()});};form.addEventListener('submit',submit,{once:true});signal.addEventListener('abort',abort,{once:true});
  });
  async function start(){
    if(running)return;running=true;controller=new AbortController();const signal=controller.signal;
    const abortOnHide=()=>{if(document.hidden)controller.abort();};document.addEventListener('visibilitychange',abortOnHide);
    const seed=crypto.getRandomValues(new Uint32Array(1))[0]||1,plan=createCognitivePlan(seed),startedAt=new Date().toISOString(),trials=[];
    dialog.showModal();
    try{
      await intro('COGNITIVE TASK BATTERY','A short practice-based assessment','Four tasks and a short questionnaire take about 5 minutes. Use a keyboard or pointer. Keep this tab visible. Only a finished run is saved.',signal);
      await intro('TASK 1 OF 4','Respond to the star','Wait for the star, then tap it or press Space as quickly as you can. Early taps count as false starts.',signal);
      for(let i=0;i<plan.vigilance.length;i++){trials.push(await vigilanceTrial(plan.vigilance[i],i,signal));await sleep(230,signal);}
      await intro('TASK 2 OF 4','Remember digits backward','Digits appear one at a time. When they disappear, type the sequence in reverse order.',signal);
      for(let i=0;i<plan.digitBackward.length;i++){trials.push(await digitTrial(plan.digitBackward[i],i,signal));await sleep(230,signal);}
      await intro('TASK 3 OF 4','Choose the middle arrow','Ignore the surrounding arrows. Use Left or Right to report the direction of the center arrow.',signal);
      for(let i=0;i<plan.flanker.length;i++){frame('TASK 3 · DISTRACTION','<h2 id="cognitive-title">+</h2>');await sleep(300,signal);trials.push(await choiceTrial('flanker',plan.flanker[i],i,plan.flanker[i].condition,signal));await sleep(230,signal);}
      await intro('TASK 4 OF 4','Switch between number rules','The cue tells you which rule to use. For parity: odd is Left, even is Right. For size: below 5 is Left, above 5 is Right.',signal);
      for(let i=0;i<plan.taskSwitch.length;i++){frame('TASK 4 · RULE SWITCHING','<h2 id="cognitive-title">+</h2>');await sleep(300,signal);trials.push(await choiceTrial('task-switch',plan.taskSwitch[i],i,plan.taskSwitch[i].condition,signal));await sleep(230,signal);}
      const answers=await questionnaire(signal);const completedAt=new Date().toISOString();
      const session={id:crypto.randomUUID(),batteryVersion:config.batteryVersion,seed,startedAt,completedAt,interruptionCount:0,
        deviceInfo:{inputMode:'keyboard-or-pointer',viewportCategory:innerWidth<600?'small':innerWidth<1000?'medium':'large'},trials,questionnaire:answers};
      addSession(session);showResult(session,getSessions());
    }catch(error){if(dialog.open){frame('ASSESSMENT INTERRUPTED',`<h2 id="cognitive-title">Run not saved</h2><p>${error.name==='AbortError'?'The tab was hidden or the assessment was closed. Start a new run when you can keep this page visible.':'An unexpected error stopped the run. Please try again.'}</p><button class="primary-button" id="cognitive-next" type="button">Close</button>`);content.querySelector('#cognitive-next').addEventListener('click',()=>dialog.close());}if(error.name!=='AbortError')console.error(error);}
    finally{document.removeEventListener('visibilitychange',abortOnHide);running=false;controller=null;render();}
  }
  function showResult(session,allSessions){
    if(!dialog.open)dialog.showModal();
    const same=allSessions.filter(s=>s.batteryVersion===config.batteryVersion).sort((a,b)=>Date.parse(a.completedAt)-Date.parse(b.completedAt));
    const index=same.findIndex(s=>s.id===session.id),metrics=summarizeCognitive(session),baseline=referenceFor(same,index,config);
    const delta=(key,unit)=>baseline.reference?.[key]==null||metrics[key]==null?'':` <small>(${Math.round(metrics[key]-baseline.reference[key])>=0?'+':''}${Math.round(metrics[key]-baseline.reference[key])}${unit} vs your reference)</small>`;
    frame('ASSESSMENT COMPLETE',`<h2 id="cognitive-title">Your run, in context</h2><p>${baseline.phase==='practice'?'This first run is practice. Two more runs will build your personal reference.':baseline.phase==='building'?'This run helps build your personal reference.':'Differences are against your own runs 2 and 3. Small changes may be noise or practice effects.'}</p><div class="cognitive-detail-grid"><div><span>Response speed</span><strong>${formatMetric(metrics.vigilanceMedianMs,' ms')}</strong>${delta('vigilanceMedianMs',' ms')}<small>${metrics.vigilanceLapses} lapses · ${metrics.vigilanceFalseStarts} false starts</small></div><div><span>Backward recall</span><strong>${formatMetric(metrics.digitAccuracy,'%')}</strong>${delta('digitAccuracy',' points')}<small>Longest correct sequence: ${metrics.digitMaxSpan} digits</small></div><div><span>Flanker choices</span><strong>${formatMetric(metrics.flankerAccuracy,'%')}</strong>${delta('flankerAccuracy',' points')}<small>Incongruent minus congruent response time: ${formatMetric(metrics.flankerInterferenceMs,' ms')}</small></div><div><span>Rule switching</span><strong>${formatMetric(metrics.switchAccuracy,'%')}</strong>${delta('switchAccuracy',' points')}<small>Switch minus repeat response time: ${formatMetric(metrics.switchCostMs,' ms')}</small></div></div><p class="research-note">These short tasks are exploratory. Timing depends on your device and environment. They do not diagnose a cognitive trait or alter your study recommendation.</p><button class="primary-button" id="cognitive-next" type="button">Done</button>`);
    content.querySelector('#cognitive-next').addEventListener('click',()=>dialog.close());
  }
  render();
  return {render,config};
}
