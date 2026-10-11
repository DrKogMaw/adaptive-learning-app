import { topics, topicById, validateCurriculum, isEligible } from './curriculum.mjs';
import { recommendBaseline, recommendationRecord } from './recommendation.mjs';
import { loadChecks, scoreResponses } from './knowledge.mjs';
import { loadStudyForms, validateStudyForms, createStudySession, recordPretest, startStudy, finishStudy, recordPosttest, isReviewDue, recordDelayed } from './study.mjs';
import { mountAccount } from './account.mjs';
import { mountCognitive } from './cognitive.mjs';

validateCurriculum();
const bank = await loadChecks();
const checksByTopic = Object.fromEntries(bank.checks.map(check => [check.topicId, check]));
const studyForms = await loadStudyForms();
validateStudyForms(bank, studyForms);
const formsByTopic = Object.fromEntries(studyForms.forms.map(form => [form.topicId, form]));
const apiReady = fetch('/api/health').then(async response => response.ok && (await response.json()).service === 'nextstep-api').catch(() => false);
const STORAGE_KEY = 'nextstep-milestone-1';
const defaultState = {status:{},goal:'all',minutes:25,override:null,attempts:[],studySessions:[],cognitiveSessions:[],recommendations:[]};
let accountController = null;
let cognitiveController = null;
let state;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  state = saved && typeof saved === 'object' ? {...defaultState,...saved,status:saved.status || {}} : structuredClone(defaultState);
} catch { state = structuredClone(defaultState); }
if (!['all','web','problem'].includes(state.goal)) state.goal='all';
if (![15,25,45].includes(Number(state.minutes))) state.minutes=25;
state.minutes=Number(state.minutes);
for (const [id,value] of Object.entries(state.status)) if (!topicById[id] || !['new','practicing','confident'].includes(value)) delete state.status[id];
if (!topicById[state.override]) state.override=null;
if (!Array.isArray(state.attempts)) state.attempts=[];
state.attempts=state.attempts.filter(attempt=>checksByTopic[attempt?.topicId] && Number.isInteger(attempt?.correct) && Array.isArray(attempt?.responses));
if (!Array.isArray(state.studySessions)) state.studySessions=[];
state.studySessions=state.studySessions.filter(session=>session?.id && formsByTopic[session.topicId] && ['pretest','studying','posttest','awaiting-review','complete'].includes(session.status));
if (!Array.isArray(state.cognitiveSessions)) state.cognitiveSessions=[];
state.cognitiveSessions=state.cognitiveSessions.filter(session=>session?.id&&Array.isArray(session.trials)&&session.questionnaire).slice(-50);
if (!Array.isArray(state.recommendations)) state.recommendations=[];
state.recommendations=state.recommendations.filter(item=>item?.id&&topicById[item.topicId]&&item.policy==='baseline'&&Number.isFinite(item.priority)).slice(-200);

const $ = selector => document.querySelector(selector);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));accountController?.scheduleSync();}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function latestAttempt(topicId){return [...state.attempts].reverse().find(attempt=>attempt.topicId===topicId);}
function formatDate(value){return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function latestSession(topicId){return [...state.studySessions].reverse().find(session=>session.topicId===topicId);}
function attemptById(id){return state.attempts.find(attempt=>attempt.id===id);}
function replaceSession(updated){state.studySessions=state.studySessions.map(session=>session.id===updated.id?updated:session);save();render();return updated;}
function effectiveRecommendation(){
  if(state.override) return {topic:topicById[state.override],override:true,fitsTime:topicById[state.override].minutes<=state.minutes};
  return recommendBaseline({topics,status:state.status,goal:state.goal,minutes:state.minutes,attempts:state.attempts,studySessions:state.studySessions});
}
function logRecommendation(rec){
  if(!rec||rec.override)return;
  const last=state.recommendations.at(-1);
  const signature=[rec.topic.id,rec.priority,state.goal,state.minutes,JSON.stringify(rec.components)].join('|');
  const lastSignature=last&&[last.topicId,last.priority,last.goal,last.minutes,JSON.stringify(last.factors)].join('|');
  if(signature===lastSignature)return;
  state.recommendations.push(recommendationRecord(rec,state));
  state.recommendations=state.recommendations.slice(-200);
  save();
}
function topicStatus(topic){return state.status[topic.id] === 'confident' ? 'confident' : state.status[topic.id] === 'practicing' ? 'practicing' : isEligible(topic,state.status) ? 'ready' : 'locked';}
function statusLabel(status){return {confident:'Confident',practicing:'Practicing',ready:'Ready',locked:'Later'}[status];}

function renderSummary(){
  const confident=topics.filter(topic=>state.status[topic.id]==='confident').length;
  const ready=topics.filter(topic=>isEligible(topic,state.status)&&state.status[topic.id]!=='confident').length;
  $('#progress-count').textContent=`${confident} / ${topics.length}`;
  $('#ready-count').textContent=ready;
  const current=effectiveRecommendation()?.topic;
  $('#path-label').textContent=current?.unit || 'Complete';
}
function renderRecommendation(){
  const rec=effectiveRecommendation();
  if(!rec){$('#recommendation').innerHTML='<span class="rec-label">PATH COMPLETE</span><h3>All topics explored</h3><p>You marked every topic confident. Revisit anything you want to practice, or reset to begin again.</p>';return;}
  const t=rec.topic;
  const reasons=[];
  if(rec.override) reasons.push('Chosen by you');
  else reasons.push(...rec.reasons);
  logRecommendation(rec);
  const note=rec.override && !isEligible(t,state.status) ? 'You chose this topic before marking its prerequisites confident.' : !rec.fitsTime ? 'This activity may take longer than your available time.' : `Suggested activity: ${t.activity}`;
  const last=latestAttempt(t.id);
  const session=latestSession(t.id);
  const alternatives=!rec.override&&rec.ranked.slice(1,4).map(item=>`<button type="button" data-alternative="${item.topic.id}"><span>${escapeHtml(item.topic.title)}</span><strong>${item.priority}</strong></button>`).join('');
  const evidence=!rec.override?`<details class="rec-explanation"><summary>Why this ranks first</summary><div class="score-summary"><span><strong>${rec.priority}</strong> priority</span><span><strong>${Math.round(rec.mastery.estimate*100)}%</strong> estimated mastery</span><span><strong>±${Math.round(rec.mastery.uncertainty*100)}</strong> uncertainty</span></div><p>This transparent planning score combines review timing, active study, time fit, goal match, learning need, difficulty, and uncertainty. It is not a predicted learning gain.</p>${alternatives?`<div class="rec-alternatives"><small>Other eligible topics</small>${alternatives}</div>`:''}</details>`:'';
  $('#recommendation').innerHTML=`<div class="rec-top"><span class="rec-label">${rec.override?'YOUR CHOICE':'RECOMMENDED NEXT'}</span><span class="rec-number">${escapeHtml(t.unit)}${rec.override?'':` · priority ${rec.priority}`}</span></div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(note)}</p><div class="rec-meta"><span>◷ ${t.minutes} min</span>${reasons.map(reason=>`<span>✓ ${escapeHtml(reason)}</span>`).join('')}${last?`<span>Latest check ${last.correct}/${last.total}</span>`:''}</div><div class="rec-actions"><button class="primary-button" type="button" data-open="${t.id}">Explore topic ↗</button>${formsByTopic[t.id]?`<button class="quiet-button" type="button" id="recommended-study">${session?'View study cycle':'Start study cycle'}</button>`:''}${rec.override?'<button class="quiet-button" type="button" id="clear-override">Back to suggestion</button>':'<a class="quiet-button" href="#curriculum">Choose another topic</a>'}</div>${evidence}`;
  $('#recommendation [data-open]').addEventListener('click',()=>openTopic(t.id));
  $('#recommended-study')?.addEventListener('click',()=>startOrResumeStudy(t.id));
  $('#clear-override')?.addEventListener('click',()=>{state.override=null;save();render();});
  $('#recommendation').querySelectorAll('[data-alternative]').forEach(button=>button.addEventListener('click',()=>openTopic(button.dataset.alternative)));
}
function renderPath(){
  const rec=effectiveRecommendation()?.topic;
  let chain=[];
  if(rec){const walk=id=>{for(const prereq of topicById[id].prerequisites)walk(prereq);if(!chain.includes(id))chain.push(id);};walk(rec.id);} 
  if(chain.length<4){for(const topic of topics){if(!chain.includes(topic.id))chain.push(topic.id);if(chain.length>=4)break;}}
  $('#path-preview').innerHTML=chain.slice(-4).map((id,index)=>{const topic=topicById[id];const status=topicStatus(topic);return `<div class="path-row ${status==='confident'?'done':status==='locked'?'locked':''}"><span class="path-index">${status==='confident'?'✓':String(index+1).padStart(2,'0')}</span><span>${escapeHtml(topic.title)}</span></div>`;}).join('');
}
let activeFilter='all';
function renderStudyPanel(){
  const sessions=[...state.studySessions].reverse();
  if(!sessions.length){
    const topic=effectiveRecommendation()?.topic;
    $('#study-panel').innerHTML=`<div class="study-empty"><div><strong>Ready for your first study cycle?</strong><p>Start with ${escapeHtml(topic?.title||'a foundation topic')}. Your progress will be saved in this browser.</p></div>${topic&&formsByTopic[topic.id]?`<button type="button" class="primary-button" id="first-study">Start study cycle</button>`:''}</div>`;
    $('#first-study')?.addEventListener('click',()=>startOrResumeStudy(topic.id));
    return;
  }
  $('#study-panel').innerHTML=sessions.map(session=>{
    const topic=topicById[session.topicId],due=isReviewDue(session);
    const label={pretest:'Precheck ready',studying:'Study in progress',posttest:'Postcheck ready','awaiting-review':due?'Review due now':'Review scheduled',complete:'Cycle complete'}[session.status];
    const detail=session.status==='awaiting-review'&&!due?`Due ${formatDate(session.dueAt)}`:session.status==='complete'?'Precheck · postcheck · delayed review recorded':topic.activity;
    const action=session.status==='complete'?'View results':due?'Review now':session.status==='awaiting-review'?'View plan':'Continue';
    return `<div class="study-entry"><span class="study-entry-icon">${session.status==='complete'?'✓':due?'!':'◷'}</span><div><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(label)} · ${escapeHtml(detail)}</span></div><button type="button" data-session="${session.id}">${action} ↗</button></div>`;
  }).join('');
  $('#study-panel').querySelectorAll('[data-session]').forEach(button=>button.addEventListener('click',()=>showStudySession(button.dataset.session)));
}
function renderTopics(){
  const shown=topics.filter(topic=>activeFilter==='all'||(activeFilter==='ready'&&isEligible(topic,state.status)&&state.status[topic.id]!=='confident')||(activeFilter==='locked'&&!isEligible(topic,state.status)));
  $('#topic-grid').innerHTML=shown.length ? shown.map((topic,index)=>{const status=topicStatus(topic),last=latestAttempt(topic.id);return `<button class="topic-card ${status==='locked'?'locked':''}" type="button" data-topic="${topic.id}" aria-label="Open ${escapeHtml(topic.title)}"><div class="topic-top"><span>${escapeHtml(topic.unit.toUpperCase())}</span><span>${String(topics.indexOf(topic)+1).padStart(2,'0')}</span></div><h3>${escapeHtml(topic.title)}</h3><p>${escapeHtml(topic.objective)}</p><div class="topic-bottom"><span>${last?`Check ${last.correct}/${last.total}`:`◷ ${topic.minutes} min`}</span><span class="topic-status ${status}">${statusLabel(status)}</span></div></button>`;}).join('') : '<div class="empty-state">No topics in this view yet. Try another filter.</div>';
  $('#topic-grid').querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>openTopic(button.dataset.topic)));
}
function render(){renderSummary();renderRecommendation();renderPath();renderStudyPanel();renderTopics();cognitiveController?.render();}

function openTopic(id){
  const t=topicById[id];
  if(!t)return;
  const status=state.status[id]||'new', eligible=isEligible(t,state.status);
  const prerequisiteNames=t.prerequisites.map(prereq=>topicById[prereq].title);
  const last=latestAttempt(id);
  const session=latestSession(id);
  $('#dialog-content').innerHTML=`<div class="dialog-body"><button class="dialog-close" type="button" aria-label="Close topic">×</button><p class="eyebrow">${escapeHtml(t.unit.toUpperCase())} · ${t.minutes} MIN</p><h2 id="dialog-title">${escapeHtml(t.title)}</h2><p>${eligible?'This topic is available based on your self reported prerequisite status.':'You can explore this topic now. Its prerequisites have not all been marked confident.'}</p><div class="dialog-objective"><strong>LEARNING OBJECTIVE</strong><p>${escapeHtml(t.objective)}</p></div><div class="dialog-detail"><strong>Practice activity:</strong> ${escapeHtml(t.activity)}</div><div class="dialog-detail"><strong>Prerequisites:</strong> ${prerequisiteNames.length?escapeHtml(prerequisiteNames.join(', ')):'None'}</div>${formsByTopic[id]?`<div class="check-callout"><div><strong>Study cycle</strong><p>Precheck · study · postcheck · 24 hour review</p></div><button class="primary-button" type="button" id="start-study">${session?'View cycle':'Start cycle'}</button></div>`:'<p class="check-unavailable">A study cycle for this topic is coming later.</p>'}${checksByTopic[id]?`<div class="check-callout"><div><strong>Standalone check</strong><p>Four JavaScript questions · ${last?`Last result ${last.correct}/${last.total}`:'No attempts yet'}</p></div><button class="primary-button" type="button" id="start-check">Start check</button></div>`:'<p class="check-unavailable">Knowledge check for this topic is coming in a later milestone.</p>'}<div class="status-controls" role="group" aria-label="Your self reported topic status">${[['new','New to me'],['practicing','Practicing'],['confident','Confident']].map(([value,label])=>`<button type="button" data-status="${value}" class="${status===value?'selected':''}">${label}</button>`).join('')}</div><div class="dialog-foot"><small>Status is your own estimate, not a tested mastery score.</small><button class="primary-button" type="button" id="choose-topic">Choose this topic</button></div></div>`;
  const dialog=$('#topic-dialog');dialog.showModal();
  $('.dialog-close').addEventListener('click',()=>dialog.close());
  $('#start-check')?.addEventListener('click',()=>{dialog.close();openQuiz(id);});
  $('#start-study')?.addEventListener('click',()=>{dialog.close();startOrResumeStudy(id);});
  $('#dialog-content').querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{state.status[id]=button.dataset.status;if(state.status[id]==='confident'&&state.override===id)state.override=null;save();dialog.close();render();openTopic(id);}));
  $('#choose-topic').addEventListener('click',()=>{state.override=id;save();dialog.close();render();location.hash='dashboard';});
}

function startOrResumeStudy(topicId){
  if(!formsByTopic[topicId])return;
  let session=latestSession(topicId);
  if(!session){
    session={...createStudySession(topicId,topicById[topicId].minutes),priorItemExposure:state.attempts.some(attempt=>attempt.topicId===topicId&&(!attempt.assessmentType||attempt.assessmentType==='diagnostic'))};
    state.studySessions.push(session);
    const record=[...state.recommendations].reverse().find(item=>item.topicId===topicId&&!item.acceptedAt);
    if(record)record.acceptedAt=new Date().toISOString();
    save();render();
  }
  showStudySession(session.id);
}
function showStudySession(sessionId){
  const session=state.studySessions.find(item=>item.id===sessionId);
  if(!session)return;
  if(session.status==='pretest')openQuiz(session.topicId,'pre',session.id);
  else if(session.status==='studying')renderStudyStage(session);
  else if(session.status==='posttest')openQuiz(session.topicId,'post',session.id);
  else renderStudySummary(session);
}
let studyTimer=null;
function renderStudyStage(session){
  if(studyTimer)clearInterval(studyTimer);
  const topic=topicById[session.topicId],dialog=$('#quiz-dialog');
  if(!dialog.open)dialog.showModal();
  const started=!!session.studyStartedAt;
  $('#quiz-content').innerHTML=`<div class="dialog-body study-body"><button class="quiz-close dialog-close" type="button" aria-label="Close study activity">×</button><p class="eyebrow">FOCUSED STUDY · ${escapeHtml(topic.unit.toUpperCase())}</p><h2 id="quiz-title">${escapeHtml(topic.title)}</h2><p>Target: ${session.plannedMinutes} minutes. The clock records elapsed time, including time away from this page.</p><div class="dialog-objective"><strong>YOUR ACTIVITY</strong><p>${escapeHtml(topic.activity)}</p></div><div class="study-clock"><strong id="elapsed-value">${started?'0:00':'Ready'}</strong><span>${started?'elapsed wall time':'Start when you are ready'}</span></div><button class="primary-button" type="button" id="study-action">${started?'Finish study and take postcheck':'Begin study'}</button></div>`;
  $('#quiz-content .quiz-close').addEventListener('click',()=>dialog.close());
  if(started){
    const updateClock=()=>{const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(session.studyStartedAt))/1000));const element=$('#elapsed-value');if(element)element.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
    updateClock();studyTimer=setInterval(updateClock,1000);
    $('#study-action').addEventListener('click',()=>{if(studyTimer)clearInterval(studyTimer);replaceSession(finishStudy(session));dialog.close();showStudySession(session.id);});
  }else $('#study-action').addEventListener('click',()=>renderStudyStage(replaceSession(startStudy(session))));
}
function renderStudySummary(session){
  const topic=topicById[session.topicId],dialog=$('#quiz-dialog');
  if(!dialog.open)dialog.showModal();
  const due=isReviewDue(session),complete=session.status==='complete';
  const pre=attemptById(session.preAttemptId),post=attemptById(session.postAttemptId),delayed=attemptById(session.delayedAttemptId);
  const score=attempt=>attempt?`${attempt.correct}/${attempt.total}`:'—';
  $('#quiz-content').innerHTML=`<div class="dialog-body study-body"><button class="quiz-close dialog-close" type="button" aria-label="Close study summary">×</button><p class="eyebrow">STUDY CYCLE · ${escapeHtml(topic.unit.toUpperCase())}</p><h2 id="quiz-title">${escapeHtml(topic.title)}</h2><p>${complete?'Your delayed review is recorded. These raw scores come from different short forms and are not a calibrated learning gain.':due?'Your delayed review is due. Try the alternate questions without looking back at the activity.':`Come back after ${formatDate(session.dueAt)} for an alternate review.`}</p><div class="study-scores"><div><span>Precheck</span><strong>${score(pre)}</strong></div><div><span>Immediate</span><strong>${score(post)}</strong></div><div><span>Delayed</span><strong>${score(delayed)}</strong></div></div><p class="study-detail">Study time recorded: ${session.actualSeconds==null?'—':`${Math.floor(session.actualSeconds/60)} min ${session.actualSeconds%60} sec`} of elapsed wall time.${session.actualSeconds<session.plannedMinutes*60?' This was shorter than the planned activity, so interpret the checks cautiously.':''}</p>${due&&!complete?'<button class="primary-button" type="button" id="begin-delayed">Start delayed review</button>':''}</div>`;
  $('#quiz-content .quiz-close').addEventListener('click',()=>dialog.close());
  $('#begin-delayed')?.addEventListener('click',()=>{dialog.close();openQuiz(session.topicId,'delayed',session.id);});
}

let activeQuiz=null;
function openQuiz(topicId,assessmentType='diagnostic',sessionId=null){
  const base=checksByTopic[topicId],forms=formsByTopic[topicId];
  const items=assessmentType==='post'?forms?.post:assessmentType==='delayed'?forms?.delayed:base?.items;
  if(!items)return;
  activeQuiz={topicId,assessmentType,sessionId,check:{topicId,items},bankVersion:['post','delayed'].includes(assessmentType)?studyForms.version:bank.version,index:0,responses:[],startedAt:new Date().toISOString(),itemStartedAt:performance.now()};
  $('#quiz-dialog').showModal();
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const quiz=activeQuiz,item=quiz.check.items[quiz.index],topic=topicById[quiz.topicId];
  const label={diagnostic:'KNOWLEDGE CHECK',pre:'PRECHECK',post:'IMMEDIATE POSTCHECK',delayed:'DELAYED REVIEW'}[quiz.assessmentType];
  const priorExposure=quiz.assessmentType==='pre'&&state.studySessions.find(session=>session.id===quiz.sessionId)?.priorItemExposure;
  $('#quiz-content').innerHTML=`<div class="dialog-body quiz-body"><button class="quiz-close dialog-close" type="button" aria-label="Close knowledge check">×</button><p class="eyebrow">${label} · ${escapeHtml(topic.title.toUpperCase())}</p><h2 id="quiz-title">Question ${quiz.index+1} of ${quiz.check.items.length}</h2><div class="quiz-progress"><span style="width:${Math.round(quiz.index/quiz.check.items.length*100)}%"></span></div>${priorExposure?'<p class="quiz-exposure">You saw these items in an earlier standalone check. This precheck may overstate your starting knowledge.</p>':''}<p class="quiz-prompt">${escapeHtml(item.prompt)}</p>${item.code?`<pre class="code-sample"><code>${escapeHtml(item.code)}</code></pre>`:''}<div class="quiz-options">${item.options.map((option,index)=>`<button type="button" data-answer="${index}"><span>${String.fromCharCode(65+index)}</span>${escapeHtml(option)}</button>`).join('')}</div><p class="quiz-hint">Choose one answer. ${quiz.assessmentType==='pre'?'Your answers will be saved without feedback until study is complete.':'Feedback appears after all questions.'}</p></div>`;
  $('#quiz-content .quiz-close').addEventListener('click',()=>$('#quiz-dialog').close());
  $('#quiz-content').querySelectorAll('[data-answer]').forEach(button=>button.addEventListener('click',async()=>{
    const selectedIndex=Number(button.dataset.answer);
    quiz.responses.push({itemId:item.id,selectedIndex,responseTimeMs:Math.round(performance.now()-quiz.itemStartedAt),answeredAt:new Date().toISOString()});
    quiz.index++;
    if(quiz.index<quiz.check.items.length){quiz.itemStartedAt=performance.now();renderQuizQuestion();}
    else await finishQuiz();
  }));
}
async function finishQuiz(){
  const quiz=activeQuiz;
  $('#quiz-content').innerHTML='<div class="dialog-body"><h2 id="quiz-title">Checking answers…</h2></div>';
  let result=scoreResponses(quiz.check,quiz.responses),source='browser';
  if(await apiReady){
    try{
      const route=quiz.assessmentType==='diagnostic'?`/api/knowledge-checks/${encodeURIComponent(quiz.topicId)}/submit`:`/api/knowledge-checks/${encodeURIComponent(quiz.topicId)}/${quiz.assessmentType}/submit`;
      const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankVersion:quiz.bankVersion,responses:quiz.responses})});
      if(response.ok){result=await response.json();source='dotnet-api';}
    }catch{/* The static preview uses the same versioned item bank in the browser. */}
  }
  const attempt={id:crypto.randomUUID(),topicId:quiz.topicId,sessionId:quiz.sessionId,assessmentType:quiz.assessmentType,bankVersion:quiz.bankVersion,startedAt:quiz.startedAt,completedAt:new Date().toISOString(),responses:quiz.responses,correct:result.correct,total:result.total,scoringSource:source};
  state.attempts.push(attempt);
  state.attempts=state.attempts.slice(-200);
  if(quiz.sessionId){
    const session=state.studySessions.find(item=>item.id===quiz.sessionId);
    if(quiz.assessmentType==='pre')replaceSession(recordPretest(session,attempt.id));
    else if(quiz.assessmentType==='post')replaceSession(recordPosttest(session,attempt.id));
    else if(quiz.assessmentType==='delayed')replaceSession(recordDelayed(session,attempt.id));
  }else{save();render();}
  const itemById=Object.fromEntries(quiz.check.items.map(item=>[item.id,item]));
  const isPre=quiz.assessmentType==='pre';
  const nextLabel={diagnostic:'Back to topic',pre:'Continue to study',post:'View review plan',delayed:'View study results'}[quiz.assessmentType];
  $('#quiz-content').innerHTML=`<div class="dialog-body quiz-body"><button class="quiz-close dialog-close" type="button" aria-label="Close results">×</button><p class="eyebrow">${isPre?'PRECHECK RECORDED':'CHECK COMPLETE'}</p><h2 id="quiz-title">${result.correct} of ${result.total} correct</h2><p>${isPre?'Your answers are saved. Study the activity next, then try a different set of questions.':'This short check is preliminary evidence, not a reliable mastery estimate. Review your answers below.'}</p>${isPre?'':`<div class="quiz-results">${result.items.map((answer,index)=>{const item=itemById[answer.itemId];return `<div class="quiz-result"><span class="result-badge ${answer.isCorrect?'correct':'incorrect'}">${answer.isCorrect?'✓':'×'}</span><div><strong>${index+1}. ${escapeHtml(item.prompt)}</strong><p>Your answer: ${escapeHtml(item.options[answer.selectedIndex])}${answer.isCorrect?'':` · Correct: ${escapeHtml(item.options[answer.correctIndex])}`}</p><small>${escapeHtml(answer.explanation)}</small></div></div>`;}).join('')}</div>`}<button class="primary-button" type="button" id="finish-check">${nextLabel}</button></div>`;
  $('#quiz-content .quiz-close').addEventListener('click',()=>$('#quiz-dialog').close());
  $('#finish-check').addEventListener('click',()=>{$('#quiz-dialog').close();quiz.sessionId?showStudySession(quiz.sessionId):openTopic(quiz.topicId);});
}

$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);
$('#goal-select').addEventListener('change',event=>{state.goal=event.target.value;state.override=null;save();render();});
$('#time-select').addEventListener('change',event=>{state.minutes=Number(event.target.value);state.override=null;save();render();});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));renderTopics();}));
$('#reset-button').addEventListener('click',()=>{const synced=accountController?.isSyncEnabled();if(confirm(synced?'Reset topic status, quiz attempts, study sessions, recommendation history, and cognitive assessments in this browser and your account?':'Reset your local topic status, quiz attempts, study sessions, recommendation history, and cognitive assessments?')){state=structuredClone(defaultState);save();$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);render();}});
$('#topic-dialog').addEventListener('click',event=>{if(event.target.id==='topic-dialog')event.target.close();});
$('#quiz-dialog').addEventListener('click',event=>{if(event.target.id==='quiz-dialog')event.target.close();});
$('#quiz-dialog').addEventListener('close',()=>{if(studyTimer)clearInterval(studyTimer);studyTimer=null;});
window.addEventListener('focus',renderStudyPanel);
setInterval(renderStudyPanel,60000);
render();
cognitiveController = await mountCognitive({
  getSessions:()=>state.cognitiveSessions,
  addSession:session=>{state.cognitiveSessions.push(session);state.cognitiveSessions=state.cognitiveSessions.slice(-50);save();render();}
});
if (await apiReady) {
  accountController = mountAccount({
    getState: () => state,
    setState: remote => {
      state = {...defaultState,...remote,status:remote.status || {},attempts:remote.attempts || [],studySessions:remote.studySessions || [],cognitiveSessions:remote.cognitiveSessions || [],recommendations:remote.recommendations || []};
      $('#goal-select').value=state.goal;
      $('#time-select').value=String(state.minutes);
      save();render();
    }
  });
}
