export const REVIEW_DELAY_MS = 24 * 60 * 60 * 1000;

export async function loadStudyForms(url = './study-forms.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load study forms');
  return response.json();
}

export function validateStudyForms(preBank, formBank) {
  if (!formBank || typeof formBank.version !== 'string' || !Array.isArray(formBank.forms)) throw new Error('Invalid study forms');
  const preByTopic = new Map(preBank.checks.map(check => [check.topicId, check]));
  const topicIds = new Set(), itemIds = new Set(preBank.checks.flatMap(check => check.items.map(item => item.id)));
  for (const form of formBank.forms) {
    if (topicIds.has(form.topicId) || !preByTopic.has(form.topicId)) throw new Error(`Invalid study topic: ${form.topicId}`);
    topicIds.add(form.topicId);
    const preCount = preByTopic.get(form.topicId).items.length;
    for (const type of ['post','delayed']) {
      if (!Array.isArray(form[type]) || form[type].length !== preCount) throw new Error(`Form length mismatch: ${form.topicId}/${type}`);
      for (const item of form[type]) {
        if (!item.id || itemIds.has(item.id) || !Array.isArray(item.options) || item.options.length < 2 || !Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length) throw new Error(`Invalid study item: ${item.id}`);
        itemIds.add(item.id);
      }
    }
  }
  return true;
}

export function createStudySession(topicId, plannedMinutes, now = new Date()) {
  return {id:crypto.randomUUID(),topicId,plannedMinutes,status:'pretest',startedAt:now.toISOString(),preAttemptId:null,studyStartedAt:null,studyCompletedAt:null,actualSeconds:null,postAttemptId:null,dueAt:null,delayedAttemptId:null};
}
export function recordPretest(session, attemptId) {
  if (session.status !== 'pretest') throw new Error('Pretest is not due');
  return {...session,status:'studying',preAttemptId:attemptId};
}
export function startStudy(session, now = new Date()) {
  if (session.status !== 'studying' || !session.preAttemptId) throw new Error('Study cannot start yet');
  return session.studyStartedAt ? session : {...session,studyStartedAt:now.toISOString()};
}
export function finishStudy(session, now = new Date()) {
  if (session.status !== 'studying' || !session.studyStartedAt) throw new Error('Study has not started');
  const seconds = Math.max(0,Math.round((now.getTime() - new Date(session.studyStartedAt).getTime()) / 1000));
  return {...session,status:'posttest',studyCompletedAt:now.toISOString(),actualSeconds:seconds};
}
export function recordPosttest(session, attemptId, now = new Date()) {
  if (session.status !== 'posttest' || !session.studyCompletedAt) throw new Error('Posttest is not due');
  return {...session,status:'awaiting-review',postAttemptId:attemptId,dueAt:new Date(now.getTime()+REVIEW_DELAY_MS).toISOString()};
}
export function isReviewDue(session, now = new Date()) {
  return session.status === 'awaiting-review' && Number.isFinite(Date.parse(session.dueAt)) && now.getTime() >= Date.parse(session.dueAt);
}
export function recordDelayed(session, attemptId, now = new Date()) {
  if (!isReviewDue(session,now)) throw new Error('Delayed review is not due');
  return {...session,status:'complete',delayedAttemptId:attemptId,reviewCompletedAt:now.toISOString()};
}
