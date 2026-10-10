import { topics, topicById, validateCurriculum, isEligible, recommend } from './curriculum.mjs';

validateCurriculum();
const STORAGE_KEY = 'nextstep-milestone-1';
const defaultState = {status:{},goal:'all',minutes:25,override:null};
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

const $ = selector => document.querySelector(selector);
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
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
  $('#recommendation').innerHTML=`<div class="rec-top"><span class="rec-label">${rec.override?'YOUR CHOICE':'RECOMMENDED NEXT'}</span><span class="rec-number">${escapeHtml(t.unit)}</span></div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(note)}</p><div class="rec-meta"><span>◷ ${t.minutes} min</span>${reasons.map(reason=>`<span>✓ ${escapeHtml(reason)}</span>`).join('')}</div><div class="rec-actions"><button class="primary-button" type="button" data-open="${t.id}">Explore topic ↗</button>${rec.override?'<button class="quiet-button" type="button" id="clear-override">Back to suggestion</button>':'<a class="quiet-button" href="#curriculum">Choose another topic</a>'}</div>`;
  $('#recommendation [data-open]').addEventListener('click',()=>openTopic(t.id));
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
  $('#topic-grid').innerHTML=shown.length ? shown.map((topic,index)=>{const status=topicStatus(topic);return `<button class="topic-card ${status==='locked'?'locked':''}" type="button" data-topic="${topic.id}" aria-label="Open ${escapeHtml(topic.title)}"><div class="topic-top"><span>${escapeHtml(topic.unit.toUpperCase())}</span><span>${String(topics.indexOf(topic)+1).padStart(2,'0')}</span></div><h3>${escapeHtml(topic.title)}</h3><p>${escapeHtml(topic.objective)}</p><div class="topic-bottom"><span>◷ ${topic.minutes} min</span><span class="topic-status ${status}">${statusLabel(status)}</span></div></button>`;}).join('') : '<div class="empty-state">No topics in this view yet. Try another filter.</div>';
  $('#topic-grid').querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>openTopic(button.dataset.topic)));
}
function render(){renderSummary();renderRecommendation();renderPath();renderTopics();}

function openTopic(id){
  const t=topicById[id];
  if(!t)return;
  const status=state.status[id]||'new', eligible=isEligible(t,state.status);
  const prerequisiteNames=t.prerequisites.map(prereq=>topicById[prereq].title);
  $('#dialog-content').innerHTML=`<div class="dialog-body"><button class="dialog-close" type="button" aria-label="Close topic">×</button><p class="eyebrow">${escapeHtml(t.unit.toUpperCase())} · ${t.minutes} MIN</p><h2 id="dialog-title">${escapeHtml(t.title)}</h2><p>${eligible?'This topic is available based on your self reported prerequisite status.':'You can explore this topic now. Its prerequisites have not all been marked confident.'}</p><div class="dialog-objective"><strong>LEARNING OBJECTIVE</strong><p>${escapeHtml(t.objective)}</p></div><div class="dialog-detail"><strong>Practice activity:</strong> ${escapeHtml(t.activity)}</div><div class="dialog-detail"><strong>Prerequisites:</strong> ${prerequisiteNames.length?escapeHtml(prerequisiteNames.join(', ')):'None'}</div><div class="status-controls" role="group" aria-label="Your self reported topic status">${[['new','New to me'],['practicing','Practicing'],['confident','Confident']].map(([value,label])=>`<button type="button" data-status="${value}" class="${status===value?'selected':''}">${label}</button>`).join('')}</div><div class="dialog-foot"><small>Status is your own estimate, not a tested mastery score.</small><button class="primary-button" type="button" id="choose-topic">Study this topic</button></div></div>`;
  const dialog=$('#topic-dialog');dialog.showModal();
  $('.dialog-close').addEventListener('click',()=>dialog.close());
  $('#dialog-content').querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{state.status[id]=button.dataset.status;if(state.status[id]==='confident'&&state.override===id)state.override=null;save();dialog.close();render();openTopic(id);}));
  $('#choose-topic').addEventListener('click',()=>{state.override=id;save();dialog.close();render();location.hash='dashboard';});
}

$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);
$('#goal-select').addEventListener('change',event=>{state.goal=event.target.value;state.override=null;save();render();});
$('#time-select').addEventListener('change',event=>{state.minutes=Number(event.target.value);state.override=null;save();render();});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));renderTopics();}));
$('#reset-button').addEventListener('click',()=>{if(confirm('Reset your local topic status and study preferences?')){state=structuredClone(defaultState);save();$('#goal-select').value=state.goal;$('#time-select').value=String(state.minutes);render();}});
$('#topic-dialog').addEventListener('click',event=>{if(event.target.id==='topic-dialog')event.target.close();});
render();
