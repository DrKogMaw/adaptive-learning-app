export const BASELINE_POLICY_VERSION = 'baseline-1.0';
export const RANDOM_POLICY_VERSION = 'randomized-eligible-1.0';

const evidenceWeight = {diagnostic:1,pre:1,post:1.25,delayed:1.75};
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));

export function estimateMastery(topicId,status,attempts=[]) {
  const prior = status[topicId] === 'confident' ? {mean:.82,strength:3} : status[topicId] === 'practicing' ? {mean:.52,strength:3} : {mean:.28,strength:3};
  let successes=prior.mean*prior.strength,total=prior.strength,observations=0;
  for(const attempt of attempts.filter(item=>item.topicId===topicId)) {
    if(!Number.isFinite(attempt.correct)||!Number.isFinite(attempt.total)||attempt.total<=0) continue;
    const weight=evidenceWeight[attempt.assessmentType||'diagnostic']||1;
    successes+=attempt.correct*weight;
    total+=attempt.total*weight;
    observations+=attempt.total;
  }
  const estimate=clamp(successes/total,.05,.95);
  const uncertainty=clamp(1/Math.sqrt(total),.12,.58);
  return {estimate,uncertainty,observations};
}

function latestSession(topicId,sessions) {
  return [...sessions].reverse().find(session=>session.topicId===topicId);
}

export function rankBaseline({topics,status={},goal='all',minutes=25,attempts=[],studySessions=[],now=new Date()}) {
  const eligible=topic=>topic.prerequisites.every(id=>status[id]==='confident');
  const reviewIsDue=topic=>{const session=latestSession(topic.id,studySessions);return session?.status==='awaiting-review'&&Number.isFinite(Date.parse(session.dueAt))&&now.getTime()>=Date.parse(session.dueAt);};
  const candidates=topics.filter(topic=>eligible(topic)&&(status[topic.id]!=='confident'||reviewIsDue(topic)));
  const ranked=candidates.map(topic=>{
    const mastery=estimateMastery(topic.id,status,attempts);
    const session=latestSession(topic.id,studySessions);
    const reviewDue=session?.status==='awaiting-review'&&Number.isFinite(Date.parse(session.dueAt))&&now.getTime()>=Date.parse(session.dueAt);
    const active=session&&['pretest','studying','posttest','awaiting-review'].includes(session.status);
    const fitsTime=topic.minutes<=minutes;
    const goalMatch=goal!=='all'&&topic.goal===goal;
    const difficultyFit=(topic.difficulty||1)<=Math.max(1,Math.ceil(minutes/15));
    const components={
      review:reviewDue?35:0,
      continuity:active?14:0,
      time:fitsTime?18:-18,
      goal:goalMatch?12:0,
      learningNeed:Math.round((1-mastery.estimate)*18),
      difficulty:difficultyFit?5:-5,
      uncertainty:Math.round(mastery.uncertainty*6)
    };
    const raw=Object.values(components).reduce((sum,value)=>sum+value,0);
    const priority=clamp(Math.round(raw),0,100);
    const reasons=['Prerequisites ready'];
    if(reviewDue)reasons.push('Delayed review is due');
    else if(active)reasons.push('Continue your active cycle');
    if(fitsTime)reasons.push('Fits your time');
    if(goalMatch)reasons.push('Matches your goal');
    if(mastery.observations)reasons.push(`Uses ${mastery.observations} answered items`);
    return {topic,priority,components,reasons,mastery,fitsTime,goalMatch,reviewDue,active,difficultyFit};
  });
  ranked.sort((a,b)=>b.priority-a.priority||Number(b.reviewDue)-Number(a.reviewDue)||topics.indexOf(a.topic)-topics.indexOf(b.topic));
  return ranked;
}

export function recommendBaseline(input) {
  const ranked=rankBaseline(input);
  return ranked.length?{...ranked[0],ranked,policyVersion:BASELINE_POLICY_VERSION}:null;
}

function hash(value){let result=2166136261;for(const char of value){result^=char.charCodeAt(0);result=Math.imul(result,16777619);}return result>>>0;}

export function recommendRandomEligible(input,assignmentId) {
  const ranked=rankBaseline(input);
  if(!ranked.length)return null;
  const context=[assignmentId,input.goal,input.minutes,...ranked.map(item=>`${item.topic.id}:${item.reviewDue}:${item.active}`)].join('|');
  const selected=ranked[hash(context)%ranked.length];
  return {...selected,ranked,policy:'randomized-eligible',policyVersion:RANDOM_POLICY_VERSION,selectionProbability:1/ranked.length,
    reasons:['Selected from prerequisite-ready topics',`${ranked.length} eligible option${ranked.length===1?'':'s'}`]};
}

export function recommendationRecord(rec,{goal,minutes},createdAt=new Date()) {
  return {
    id:crypto.randomUUID(),createdAt:createdAt.toISOString(),policy:rec.policy||'baseline',modelVersion:rec.policyVersion,
    topicId:rec.topic.id,priority:rec.priority,selectionProbability:rec.selectionProbability??1,candidateCount:rec.ranked.length,
    goal,minutes,reasons:rec.reasons,factors:rec.components,masteryEstimate:rec.mastery.estimate,
    masteryUncertainty:rec.mastery.uncertainty,acceptedAt:null
  };
}
