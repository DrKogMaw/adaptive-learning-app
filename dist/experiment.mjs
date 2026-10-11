export const EXPERIMENT_VERSION='feasibility-1.0';
export const EVENT_SCHEMA_VERSION='1.0';
export const POLICIES=['baseline','randomized-eligible'];

export function createAssignment(randomValue=crypto.getRandomValues(new Uint32Array(1))[0]/2**32,now=new Date()){
  const policy=randomValue<.5?'baseline':'randomized-eligible';
  return {id:crypto.randomUUID(),experimentVersion:EXPERIMENT_VERSION,policy,assignmentProbability:.5,assignedAt:now.toISOString()};
}

export function validAssignment(value){
  return value?.id&&value.experimentVersion===EXPERIMENT_VERSION&&POLICIES.includes(value.policy)&&value.assignmentProbability===.5&&Number.isFinite(Date.parse(value.assignedAt));
}

export function researchEvent(type,payload={},sessionId,now=new Date()){
  return {id:crypto.randomUUID(),schemaVersion:EVENT_SCHEMA_VERSION,type,occurredAt:now.toISOString(),sessionId,payload};
}
