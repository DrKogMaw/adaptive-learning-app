import { summarizeCognitive } from './cognitive.mjs';

const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const score=(attempts,id)=>{const value=attempts.find(item=>item.id===id);return value?`${value.correct}/${value.total}`:'';};
const csv=value=>`"${String(value??'').replaceAll('"','""')}"`;

export function analyzePilot(state,now=new Date()){
  const sessions=state.studySessions||[],attempts=state.attempts||[],events=state.researchEvents||[],cognitive=state.cognitiveSessions||[];
  const due=sessions.filter(item=>item.status==='awaiting-review'&&Date.parse(item.dueAt)<=now.getTime());
  const completed=sessions.filter(item=>item.status==='complete');
  const paired=sessions.filter(item=>item.preAttemptId&&item.postAttemptId);
  const timed=sessions.filter(item=>Number.isFinite(item.actualSeconds)&&item.actualSeconds>0);
  const eligibleForDelay=sessions.filter(item=>item.status==='complete'||(item.status==='awaiting-review'&&Date.parse(item.dueAt)<=now.getTime()));
  const delayed=eligibleForDelay.filter(item=>item.delayedAttemptId);
  const shown=events.filter(item=>item.type==='recommendation_shown').length;
  const accepted=events.filter(item=>item.type==='recommendation_accepted').length;
  const overrides=events.filter(item=>item.type==='topic_override_selected').length;
  const required=sessions.length*3+eligibleForDelay.length;
  const present=sessions.filter(item=>item.preAttemptId).length+sessions.filter(item=>item.postAttemptId).length+timed.length+delayed.length;
  const completeness=required?Math.round(100*present/required):0;
  const durations=timed.map(item=>item.actualSeconds/60);
  let practice=null,stability=null;
  if(cognitive.length>=2){const a=summarizeCognitive(cognitive[0]),b=summarizeCognitive(cognitive[1]);practice={speedMs:a.vigilanceMedianMs!=null&&b.vigilanceMedianMs!=null?Math.round(b.vigilanceMedianMs-a.vigilanceMedianMs):null,accuracyPoints:Math.round(median([b.digitAccuracy-a.digitAccuracy,b.flankerAccuracy-a.flankerAccuracy,b.switchAccuracy-a.switchAccuracy])||0)};}
  if(cognitive.length>=3){const a=summarizeCognitive(cognitive[1]),b=summarizeCognitive(cognitive[2]);const differences=[Math.abs((a.digitAccuracy??0)-(b.digitAccuracy??0)),Math.abs((a.flankerAccuracy??0)-(b.flankerAccuracy??0)),Math.abs((a.switchAccuracy??0)-(b.switchAccuracy??0))];const accuracyDifference=median(differences);const speedDifference=a.vigilanceMedianMs!=null&&b.vigilanceMedianMs!=null?Math.abs(a.vigilanceMedianMs-b.vigilanceMedianMs):null;stability={accuracyDifference,speedDifference,label:accuracyDifference<=10&&(speedDifference==null||speedDifference<=100)?'Fairly consistent':'Variation to inspect'};}
  const issues=[];
  if(!sessions.length)issues.push('No study cycle has started.');
  if(sessions.some(item=>!item.preAttemptId))issues.push('At least one cycle is missing a precheck.');
  if(sessions.some(item=>['awaiting-review','complete'].includes(item.status)&&!item.postAttemptId))issues.push('At least one studied cycle is missing an immediate postcheck.');
  if(due.length)issues.push(`${due.length} delayed review${due.length===1?' is':'s are'} overdue.`);
  if(cognitive.length<3)issues.push(`${3-cognitive.length} more cognitive run${3-cognitive.length===1?' is':'s are'} needed for a personal stability check.`);
  return {sessions:sessions.length,completed:completed.length,paired:paired.length,due:due.length,delayed:delayed.length,eligibleForDelay:eligibleForDelay.length,completeness,shown,accepted,overrides,acceptanceRate:shown?Math.round(100*accepted/shown):null,overrideRate:shown?Math.round(100*overrides/shown):null,medianMinutes:median(durations),cognitiveRuns:cognitive.length,practice,stability,issues,policy:state.experimentAssignment?.policy||'unassigned'};
}

export function buildPilotCsv(state){
  const attempts=state.attempts||[],policy=state.experimentAssignment?.policy||'';
  const header=['study_session_id','policy','topic_id','status','started_at','planned_minutes','actual_seconds','pre_score','post_score','delayed_score','due_at','review_completed_at','prior_item_exposure'];
  const rows=(state.studySessions||[]).map(item=>[item.id,policy,item.topicId,item.status,item.startedAt,item.plannedMinutes,item.actualSeconds??'',score(attempts,item.preAttemptId),score(attempts,item.postAttemptId),score(attempts,item.delayedAttemptId),item.dueAt||'',item.reviewCompletedAt||'',item.priorItemExposure]);
  return [header,...rows].map(row=>row.map(csv).join(',')).join('\r\n');
}

export function mountPilot({getState}){
  const panel=document.querySelector('#pilot-panel');
  const render=()=>{
    const state=getState(),report=analyzePilot(state);
    const delayedRate=report.eligibleForDelay?`${Math.round(100*report.delayed/report.eligibleForDelay)}%`:'—';
    const status=report.completeness>=85&&report.cognitiveRuns>=3?'Ready to inspect':report.sessions||report.cognitiveRuns?'Collecting pilot data':'Ready to begin';
    panel.innerHTML=`<div class="pilot-status"><div><span>PERSONAL DATA STATUS</span><strong>${status}</strong><p>This view checks whether your record is complete enough for pilot analysis. It does not estimate treatment effects.</p></div><div class="quality-ring" style="--quality:${report.completeness}%"><strong>${report.completeness}%</strong><span>cycle fields</span></div></div><div class="pilot-metrics"><div><span>Study cycles</span><strong>${report.completed}/${report.sessions}</strong><small>completed / started</small></div><div><span>Delayed reviews</span><strong>${delayedRate}</strong><small>${report.delayed} of ${report.eligibleForDelay} due</small></div><div><span>Recommendation uptake</span><strong>${report.acceptanceRate==null?'—':`${report.acceptanceRate}%`}</strong><small>${report.accepted} accepted · ${report.overrides} overrides</small></div><div><span>Cognitive runs</span><strong>${report.cognitiveRuns}/3</strong><small>${report.stability?report.stability.label:'personal reference target'}</small></div></div><div class="pilot-detail-grid"><div><h3>Checks to resolve</h3>${report.issues.length?`<ul>${report.issues.map(item=>`<li>${item}</li>`).join('')}</ul>`:'<p class="pilot-clear">✓ No current completeness flags.</p>'}</div><div><h3>Measurement notes</h3><p>${report.medianMinutes==null?'Complete a timed study session to measure engagement time.':`Median recorded study time: ${Math.round(report.medianMinutes)} minutes.`}</p><p>${report.practice?`Practice to reference change: ${report.practice.speedMs==null?'speed unavailable':`${report.practice.speedMs>0?'+':''}${report.practice.speedMs} ms response speed`}, ${report.practice.accuracyPoints>0?'+':''}${report.practice.accuracyPoints} accuracy points.`:'A practice effect check appears after two cognitive runs.'}</p></div></div><div class="pilot-actions"><button type="button" class="quiet-button" id="export-pilot">Export study-session CSV</button><a href="analysis-plan.md" class="quiet-button" target="_blank" rel="noopener">Read analysis plan ↗</a></div>`;
    panel.querySelector('#export-pilot').addEventListener('click',()=>{const blob=new Blob([buildPilotCsv(state)],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='nextstep-pilot-sessions.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});
  };
  render();return {render};
}
