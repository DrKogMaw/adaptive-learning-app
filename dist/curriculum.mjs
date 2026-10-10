export const topics = [
  {id:'cs.variables',title:'Variables & values',unit:'Foundations',minutes:15,goal:'all',prerequisites:[],objective:'Create variables and explain how values are stored and updated.',activity:'Write a tiny program that stores a name, a number, and a boolean. Change each value and predict the output.'},
  {id:'cs.types',title:'Data types',unit:'Foundations',minutes:15,goal:'all',prerequisites:['cs.variables'],objective:'Distinguish strings, numbers, and booleans in a short program.',activity:'Sort example values by type, then predict the result of three simple expressions.'},
  {id:'cs.operators',title:'Operators & expressions',unit:'Foundations',minutes:15,goal:'all',prerequisites:['cs.types'],objective:'Evaluate arithmetic and comparison expressions.',activity:'Predict the result of five expressions, then check them in a code editor.'},
  {id:'cs.conditionals',title:'Conditionals',unit:'Foundations',minutes:25,goal:'all',prerequisites:['cs.operators'],objective:'Trace and write if/else branches for a given condition.',activity:'Trace three decision trees and implement a small grade classifier.'},
  {id:'cs.loops',title:'Loops',unit:'Foundations',minutes:25,goal:'all',prerequisites:['cs.conditionals'],objective:'Use a loop to repeat an action and determine when it stops.',activity:'Trace loop variables line by line, then write a counter and an accumulator.'},
  {id:'cs.functions',title:'Functions',unit:'Foundations',minutes:25,goal:'all',prerequisites:['cs.variables','cs.conditionals'],objective:'Define a function with inputs, output, and a clear purpose.',activity:'Extract repeated logic into a function and test it with three inputs.'},
  {id:'cs.scope',title:'Scope',unit:'Core skills',minutes:25,goal:'all',prerequisites:['cs.functions'],objective:'Explain which variables are accessible inside and outside a function.',activity:'Predict the output of three short programs with local and outer variables.'},
  {id:'cs.arrays',title:'Arrays & lists',unit:'Core skills',minutes:25,goal:'all',prerequisites:['cs.loops'],objective:'Access, update, and iterate over a sequence of values.',activity:'Build a small list, then compute its total and largest item.'},
  {id:'cs.objects',title:'Objects & records',unit:'Core skills',minutes:25,goal:'web',prerequisites:['cs.arrays'],objective:'Represent a real item with named properties.',activity:'Create a book record and write a function that formats its details.'},
  {id:'cs.strings',title:'String processing',unit:'Core skills',minutes:25,goal:'web',prerequisites:['cs.loops','cs.functions'],objective:'Transform and inspect strings using basic operations.',activity:'Write a function that normalizes a name and counts matching characters.'},
  {id:'cs.debugging',title:'Debugging basics',unit:'Core skills',minutes:25,goal:'all',prerequisites:['cs.functions','cs.loops'],objective:'Locate a faulty assumption using traces and small test cases.',activity:'Fix three short programs by reproducing the bug and inspecting intermediate values.'},
  {id:'cs.recursion',title:'Recursion',unit:'Problem solving',minutes:25,goal:'problem',prerequisites:['cs.functions','cs.conditionals'],objective:'Trace a recursive call and identify its base case.',activity:'Trace three recursive functions, predict outputs, then implement one simple recursive solution.'},
  {id:'cs.complexity',title:'Algorithmic complexity',unit:'Problem solving',minutes:25,goal:'problem',prerequisites:['cs.loops','cs.functions'],objective:'Compare the growth of simple loop based algorithms.',activity:'Count operations in three short algorithms and compare their growth.'},
  {id:'cs.search',title:'Searching',unit:'Problem solving',minutes:25,goal:'problem',prerequisites:['cs.arrays','cs.conditionals'],objective:'Explain and implement a linear search over a list.',activity:'Trace linear search and write tests for found, missing, and empty cases.'},
  {id:'cs.sort',title:'Sorting concepts',unit:'Problem solving',minutes:45,goal:'problem',prerequisites:['cs.arrays','cs.loops'],objective:'Trace a simple sorting algorithm and explain its steps.',activity:'Sort a small list by hand, then implement and inspect a basic sorting method.'},
  {id:'cs.recursive-trees',title:'Recursive trees',unit:'Problem solving',minutes:45,goal:'problem',prerequisites:['cs.recursion'],objective:'Draw the branching calls made by a recursive function.',activity:'Sketch the call tree of Fibonacci and explain where repeated work occurs.'},
  {id:'cs.backtracking',title:'Backtracking',unit:'Problem solving',minutes:45,goal:'problem',prerequisites:['cs.recursive-trees','cs.arrays'],objective:'Describe how a search explores and undoes choices.',activity:'Trace a simple maze or combination search and implement one backtracking step.'},
  {id:'cs.dom',title:'The document object model',unit:'Web applications',minutes:25,goal:'web',prerequisites:['cs.objects','cs.functions'],objective:'Find and update page elements in response to user actions.',activity:'Build a button that changes visible text and explain each DOM operation.'},
  {id:'cs.events',title:'Events & interactions',unit:'Web applications',minutes:25,goal:'web',prerequisites:['cs.dom'],objective:'Connect a user action to a handler and update the interface.',activity:'Build a simple form with input validation and a live result.'},
  {id:'cs.async',title:'Async data flow',unit:'Web applications',minutes:45,goal:'web',prerequisites:['cs.events','cs.functions'],objective:'Explain the states of an asynchronous request.',activity:'Add loading, success, and error states to a data fetching interface.'}
];

export const topicById = Object.fromEntries(topics.map(topic => [topic.id, topic]));

export function validateCurriculum(items = topics) {
  const byId = new Map(items.map(topic => [topic.id, topic]));
  if (byId.size !== items.length) throw new Error('Duplicate topic ID');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error(`Missing prerequisite: ${id}`);
    if (visiting.has(id)) throw new Error(`Prerequisite cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prereq of byId.get(id).prerequisites) visit(prereq);
    visiting.delete(id); visited.add(id);
  }
  for (const item of items) visit(item.id);
  return true;
}

export function isEligible(topic, status) {
  return topic.prerequisites.every(id => status[id] === 'confident');
}

export function recommend(items, status, goal, minutes) {
  const candidates = items.filter(topic => isEligible(topic, status) && status[topic.id] !== 'confident');
  if (!candidates.length) return null;
  const ranked = candidates.map(topic => {
    const fitsTime = topic.minutes <= minutes;
    const isGoal = goal !== 'all' && topic.goal === goal;
    const practicing = status[topic.id] === 'practicing';
    // This is a deterministic planning score, not a predicted learning gain.
    const score = (fitsTime ? 100 : 0) + (isGoal ? 20 : 0) + (practicing ? -5 : 0) - topic.minutes / 10;
    return {topic,score,fitsTime,isGoal,practicing};
  }).sort((a,b) => b.score - a.score || items.indexOf(a.topic) - items.indexOf(b.topic));
  return ranked[0];
}
