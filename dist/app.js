import { topics, topicById, validateCurriculum, isEligible, recommend } from './curriculum.mjs';
import { loadChecks, scoreResponses } from './knowledge.mjs';

validateCurriculum();
const bank = await loadChecks();
const checksByTopic = Object.fromEntries(bank.checks.map(check => [check.topicId, check]));
const apiReady = fetch('/api/health').then(async response => response.ok && (await response.json()).service === 'nextstep-api').catch(() => false);
const STORAGE_KEY = 'nextstep-milestone-1';
const defaultState = {status:{},goal:'all',minutes:25,override:null,attempts:[]};
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

const $ = selector => document.querySelector(selector);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function latestAttempt(topicId){return [...state.attempts].reverse().find(attempt=>attempt.topicId===topicId);}
function effectiveRecommendation(){
  if(state.override) return {topic:topicById[state.override],override:true,fitsTime:topicById[state.override].minutes<=state.minutes};
  return recommend(topics,state.status,state.goal,state.minutes);
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
  else {reasons.push('Prerequisites ready');if(rec.isGoal) reasons.push('Matches your goal');if(rec.fitsTime) reasons.push('Fits your time');}
  const note=rec.override && !isEligible(t,state.status) ? 'You chose this topic before marking its prerequisites confident.' : !rec.fitsTime ? 'This activity may take longer than your available time.' : `Suggested activity: ${t.activity}`;
  const last=latestAttempt(t.id);
  $('#recommendation').innerHTML=`<div class="rec-top"><span class="rec-label">${rec.override?'YOUR CHOICE':'RECOMMENDED NEXT'}</span><span class="rec-number">${escapeHtml(t.unit)}</span></div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(note)}</p><div class="rec-meta"><span>◷ ${t.minutes} min</span>${reasons.map(reason=>`<span>✓ ${escapeHtml(reason)}</span>`).join('')}${last?`<span>Latest check ${last.correct}/${last.total}</span>`:''}</div><div class="rec-actions"><button class="primary-button" type="button" data-open="${t.id}">Explore topic ↗</button>${checksByTopic[t.id]?`<button class="quiet-button" type="button" id="start-recommended-check">Knowledge check</button>`:''}${rec.override?'<button class="quiet-button" type="button" id="clear-override">Back to suggestion</button>':'<a class="quiet-button" href="#curriculum">Choose another topic</a>'}</div>`;
  $('#recommendation [data-open]').addEventListener('click',()=>openTopic(t.id));
  $('#start-recommended-check')?.addEventListener('click',()=>openQuiz(t.id));
  $('#clear-override')?.addEventListener('click',()=>{state.override=null;save();render();});
}
function renderPath(){
  const rec=effectiveRecommendation()?.topic;
  let chain=[];
  if(rec){const walk=id=>{for(const prereq of topicById[id].prerequisites)walk(prereq);if(!chain.includes(id))chain.push(id);};walk(rec.id);} 
  if(chain.length<4){for(const topic of topics){if(!chain.includes(topic.id))chain.push(topic.id);if(chain.length>=4)break;}}
  $('#path-preview').innerHTML=chain.slice(-4).map((id,index)=>{const topic=topicById[id];const status=topicStatus(topic);return `<div class="path-row ${status==='confident'?'done':status==='locked'?'locked':''}"><span class="path-index">${status==='confident'?'✓':String(index+1).padStart(2,'0')}</span><span>${escapeHtml(topic.title)}</span></div>`;}).join('');
}
let activeFilter='all';
function renderTopics(){
  const shown=topics.filter(topic=>activeFilter==='all'||(activeFilter==='ready'&&isEligible(topic,state.status)&&state.status[topic.id]!=='confident')||(activeFilter==='locked'&&!isEligible(topic,state.status)));
  $('#topic-grid').innerHTML=shown.length ? shown.map((topic,index)=>{const status=topicStatus(topic),last=latestAttempt(topic.id);return `<button class="topic-card ${status==='locked'?'locked':''}" type="button" data-topic="${topic.id}" aria-label="Open ${escapeHtml(topic.title)}"><div class="topic-top"><span>${escapeHtml(topic.unit.toUpperCase())}</span><span>${String(topics.indexOf(topic)+1).padStart(2,'0')}</span></div><h3>${escapeHtml(topic.title)}</h3><p>${escapeHtml(topic.objective)}</p><div class="topic-bottom"><span>${last?`Check ${last.correct}/${last.total}`:`◷ ${topic.minutes} min`}</span><span class="topic-status ${status}">${statusLabel(status)}</span></div></button>`;}).join('') : '<div class="empty-state">No topics in this view yet. Try another filter.</div>';
  $('#topic-grid').querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>openTopic(button.dataset.topic)));
}
function render(){renderSummary();renderRecommendation();renderPath();renderTopics();}

function openTopic(id){
  const t=topicById[id];
  if(!t)return;
  const status=state.status[id]||'new', eligible=isEligible(t,state.status);
  const prerequisiteNames=t.prerequisites.map(prereq=>topicById[prereq].title);
  const last=latestAttempt(id);
  $('#dialog-content').innerHTML=`<div class="dialog-body"><button class="dialog-close" type="button" aria-label="Close topic">×</button><p class="eyebrow">${escapeHtml(t.unit.toUpperCase())} · ${t.minutes} MIN</p><h2 id="dialog-title">${escapeHtml(t.title)}</h2><p>${eligible?'This topic is available based on your self reported prerequisite status.':'You can explore this topic now. Its prerequisites have not all been marked confident.'}</p><div class="dialog-objective"><strong>LEARNING OBJECTIVE</strong><p>${escapeHtml(t.objective)}</p></div><div class="dialog-detail"><strong>Practice activity:</strong> ${escapeHtml(t.activity)}</div><div class="dialog-detail"><strong>Prerequisites:</strong> ${prerequisiteNames.length?escapeHtml(prerequisiteNames.join(', ')):'None'}</div>${checksByTopic[id]?`<div class="check-callout"><div><strong>Knowledge check</strong><p>Four JavaScript questions · ${last?`Last result ${last.correct}/${last.total}`:'No attempts yet'}</p></div><button class="primary-button" type="button" id="start-check">Start check</button></div>`:'<p class="check-unavailable">Knowledge check for this topic is coming in a later milestone.</p>'}<div class="status-controls" role="group" aria-label="Your self reported topic status">${[['new','New to me'],['practicing','Practicing'],['confident','Confident']].map(([value,label])=>`<button type="button" data-status="${value}" class="${status===value?'selected':''}">${label}</button>`).join('')}</div><div class="dialog-foot"><small>Status is your own estimate, not a tested mastery score.</small><button class="primary-button" type="button" id="choose-topic">Study this topic</button></div></div>`;
  const dialog=$('#topic-dialog');dialog.showModal();
  $('.dialog-close').addEventListener('click',()=>dialog.close());
  $('#start-check')?.addEventListener('click',()=>{dialog.close();openQuiz(id);});
  $('#dialog-content').querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{state.status[id]=button.dataset.status;if(state.status[id]==='confident'&&state.override===id)state.override=null;save();dialog.close();render();openTopic(id);}));
  $('#choose-topic').addEventListener('click',()=>{state.override=id;save();dialog.close();render();location.hash='dashboard';});
}

let activeQuiz=null;
function openQuiz(topicId){
  const check=checksByTopic[topicId];
  if(!check)return;
  activeQuiz={topicId,check,index:0,responses:[],startedAt:new Date().toISOString(),itemStartedAt:performance.now()};
  $('#quiz-dialog').showModal();
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const quiz=activeQuiz,item=quiz.check.items[quiz.index],topic=topicById[quiz.topicId];
  $('#quiz-content').innerHTML=`<div class="dialog-body quiz-body"><button class="quiz-close dialog-close" type="button" aria-label="Close knowledge check">×</button><p class="eyebrow">KNOWLEDGE CHECK · ${escapeHtml(topic.title.toUpperCase())}</p><h2 id="quiz-title">Question ${quiz.index+1} of ${quiz.check.items.length}</h2><div class="quiz-progress"><span style="width:${Math.round(quiz.index/quiz.check.items.length*100)}%"></span></div><p class="quiz-prompt">${escapeHtml(item.prompt)}</p>${item.code?`<pre class="code-sample"><code>${escapeHtml(item.code)}</code></pre>`:''}<div class="quiz-options">${item.options.map((option,index)=>`<button type="button" data-answer="${index}"><span>${String.fromCharCode(65+index)}</span>${escapeHtml(option)}</button>`).join('')}</div><p class="quiz-hint">Choose one answer. Feedback appears after all four questions.</p></div>`;
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
      const response=await fetch(`/api/knowledge-checks/${encodeURIComponent(quiz.topicId)}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankVersion:bank.version,responses:quiz.responses})});
      if(response.ok){result=await response.json();source='dotnet-api';}
    }catch{/* The static preview uses the same versioned item bank in the browser. */}
  }
  const attempt={id:crypto.randomUUID(),topicId:quiz.topicId,bankVersion:bank.version,startedAt:quiz.startedAt,completedAt:new Date().toISOString(),responses:quiz.responses,correct:result.correct,total:result.total,scoringSource:source};
  state.attempts.push(attempt);
  state.attempts=state.attempts.slice(-100);
  save();render();
  const itemById=Object.fromEntries(quiz.check.items.map(item=>[item.id,item]));
  $('#quiz-content').innerHTML=`<div class="dialog-body quiz-body"><button class="quiz-close dialog-close" type="button" aria-label="Close results">×</button><p class="eyebrow">CHECK COMPLETE</p><h2 id="quiz-title">${result.correct} of ${result.total} correct</h2><p>This is a short check, not a reliable mastery estimate. Review each answer, then decide what to practice.</p><div class="quiz-results">${result.items.map((answer,index)=>{const item=itemById[answer.itemId];return `<div class="quiz-result"><span class="result-badge ${answer.isCorrect?'correct':'incorrect'}">${answer.isCorrect?'✓':'×'}</span><div><strong>${index+1}. ${escapeHtml(item.prompt)}</strong><p>Your answer: ${escapeHtml(item.options[answer.selectedIndex])}${answer.isCorrect?'':` · Correct: ${escapeHtml(item.options[answer.correctIndex])}`}</p><small>${escapeHtml(answer.explanation)}</small></div></div>`;}).join('')}</div><button class="primary-button" type="button" id="finish-check">Back to topic</button></div>`;
  $('#quiz-content .quiz-close').addEventListener('click',()=>$('#quiz-dialog').close());
  $('#finish-check').addEventListener('click',()=>{$('#quiz-dialog').close();openTopic(quiz.topicId);});
}

$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);
$('#goal-select').addEventListener('change',event=>{state.goal=event.target.value;state.override=null;save();render();});
$('#time-select').addEventListener('change',event=>{state.minutes=Number(event.target.value);state.override=null;save();render();});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));renderTopics();}));
$('#reset-button').addEventListener('click',()=>{if(confirm('Reset your local topic status and study preferences?')){state=structuredClone(defaultState);save();$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);render();}});
$('#topic-dialog').addEventListener('click',event=>{if(event.target.id==='topic-dialog')event.target.close();});
$('#quiz-dialog').addEventListener('click',event=>{if(event.target.id==='quiz-dialog')event.target.close();});
render();
