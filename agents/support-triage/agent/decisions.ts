import { DecisionQuestion } from '../engine/decision/types';
import { DecisionEffects, Scenario } from '../engine/types';
import { isCategory } from './fields';
import { SupportState } from './flow';
import { prompts } from './prompts';

// The decision model's (Jev's) own questions for this agent: which are asked in which states, asked with the
// engine's "outcome" question on each check, and what their confident answers do. The questions' wording is in
// prompts.ts; the keyword hints here are only for the offline heuristic stand-in.

const { questions, notes } = prompts;
const asQuestion = (id: keyof typeof questions) => ({
  id,
  prompt: questions[id].prompt,
  options: Object.keys(questions[id].options),
  optionDescriptions: questions[id].options as Record<string, string>,
});

const FRUSTRATION: DecisionQuestion = {
  ...asQuestion('frustration'),
  hints: {
    annoyed: ['again', 'still', 'seriously', 'come on', 'how long'],
    angry: ['ridiculous', 'unacceptable', 'furious', 'angry', 'worst', 'sick of', 'fed up', 'third time', '!!'],
  },
  fallback: 'calm',
};

const CATEGORY: DecisionQuestion = {
  ...asQuestion('category'),
  hints: {
    billing: ['charge', 'charged', 'bill', 'payment', 'refund', 'invoice'],
    technical: ['internet', 'wifi', 'slow', 'down', 'router', 'dropping', 'connection', 'outage'],
    account_access: ['password', 'log in', 'login', 'locked', 'sign in'],
    cancel_service: ['cancel', 'cancellation', 'switch provider', 'end my service'],
  },
  fallback: 'unclear',
};

const FIXED: DecisionQuestion = {
  ...asQuestion('fixed'),
  hints: {
    yes: ['works', 'working', 'fixed', "it's back", 'thanks', 'perfect', 'got it'],
    no: ['still', "doesn't", 'not working', 'nothing', 'same'],
  },
  fallback: 'unsure',
};

export const supportDecisionQuestions: NonNullable<Scenario<SupportState>['decisionQuestions']> = (state) => {
  const questions = [FRUSTRATION];
  if (state === 'greeting' || state === 'classify_issue') questions.push(CATEGORY);
  if (state === 'self_serve') questions.push(FIXED);
  return questions;
};

const confident = (answer: { best: string; p: Record<string, number> } | undefined, threshold: number) =>
  answer && (answer.p[answer.best] ?? 0) >= threshold ? answer.best : undefined;

export const applySupportDecision: NonNullable<Scenario<SupportState>['applyDecision']> = ({
  state,
  proposedAction,
  accepted,
  answers,
  callData,
  acceptThreshold,
  lastCallerText,
}) => {
  const effects: DecisionEffects = { callData: {} };

  // When the observer sees the caller state their issue, record it in their own words
  // so issue_stated can be applied without waiting for the agent.
  if (accepted && proposedAction === 'issue_stated' && !callData.issue_summary && lastCallerText) {
    effects.callData!.issue_summary = lastCallerText;
  }

  // Frustration is scored on every check, accepted or not.
  const mood = confident(answers.frustration, acceptThreshold);
  if (mood) effects.callData!.frustration = mood;
  if (mood === 'angry' && state !== 'escalate') {
    effects.note = notes.callerAngry;
  }

  // A confident category from the decision model wins over the agent's.
  const category = confident(answers.category, acceptThreshold);
  if (accepted && isCategory(category)) effects.callData!.category = category;

  // The caller clearly said it's fixed: lets issue_resolved through even without a knowledge base article.
  if (state === 'self_serve' && confident(answers.fixed, acceptThreshold) === 'yes') effects.callData!.caller_confirmed_fixed = true;

  // Don't mark an issue resolved when the caller clearly said it isn't.
  if (proposedAction === 'issue_resolved' && confident(answers.fixed, acceptThreshold) === 'no') {
    effects.veto = notes.stillNotFixed;
  }

  return effects;
};
