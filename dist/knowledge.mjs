export async function loadChecks(url = './questions.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load knowledge checks');
  const bank = await response.json();
  validateChecks(bank);
  return bank;
}

export function validateChecks(bank) {
  if (!bank || typeof bank.version !== 'string' || !Array.isArray(bank.checks)) throw new Error('Invalid knowledge check bank');
  const ids = new Set();
  for (const check of bank.checks) {
    if (!check.topicId || !Array.isArray(check.items) || check.items.length < 3) throw new Error(`Invalid check: ${check.topicId}`);
    for (const item of check.items) {
      if (!item.id || ids.has(item.id) || !Array.isArray(item.options) || item.options.length < 2 || !Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length) throw new Error(`Invalid item: ${item.id}`);
      ids.add(item.id);
    }
  }
  return true;
}

export function scoreResponses(check, responses) {
  if (!Array.isArray(responses) || responses.length !== check.items.length) throw new Error('A response is required for every item');
  const byId = new Map(responses.map(response => [response.itemId,response]));
  if (byId.size !== check.items.length) throw new Error('Duplicate item response');
  const items = check.items.map(item => {
    const response=byId.get(item.id);
    if (!response || !Number.isInteger(response.selectedIndex) || response.selectedIndex < 0 || response.selectedIndex >= item.options.length) throw new Error(`Invalid response: ${item.id}`);
    return {itemId:item.id,selectedIndex:response.selectedIndex,correctIndex:item.correctIndex,isCorrect:response.selectedIndex===item.correctIndex,explanation:item.explanation};
  });
  return {correct:items.filter(item=>item.isCorrect).length,total:items.length,items};
}
