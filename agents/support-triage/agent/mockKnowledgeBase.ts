import { Category } from './fields';

// ----------------------------------------------------------------------------- //
// Mock knowledge base: a placeholder to get started. Six short articles, picked //
// by keyword, so test calls are predictable. The tool server searches it when   //
// the call reaches self_serve and puts the article's steps in the agent's goal. //
//                                                                               //
// For production, use a real retrieval (RAG) system: an Ultravox corpus with    //
// the built-in queryCorpus tool, or your own search behind the tool server.     //
// See "Using a real knowledge base" in the README.                              //
// ----------------------------------------------------------------------------- //

export interface Article {
  id: string;
  title: string;
  category: Category;
  keywords: string[];
  /** Short steps the agent can say one or two at a time. */
  steps: string[];
  /** The detail that says the caller already tried this fix (e.g. router_restarted): then it isn't offered. */
  triedWhen?: string;
}

export const ARTICLES: Article[] = [
  {
    id: 'kb-restart-router',
    title: 'Restart your router',
    category: 'technical',
    keywords: ['slow', 'down', 'offline', 'no internet', 'not working', 'dropping', 'wifi', 'router', 'connection'],
    triedWhen: 'router_restarted',
    steps: [
      'Unplug the router from power.',
      'Wait 30 seconds, then plug it back in.',
      'Wait about two minutes until the internet light is solid.',
      'Try loading a website.',
    ],
  },
  {
    id: 'kb-check-outage',
    title: 'Check for an outage in your area',
    category: 'technical',
    keywords: ['outage', 'restarted', 'already restarted', 'still down', 'neighbors', 'area', 'down'],
    steps: [
      'There is no reported outage in the area right now.',
      'Check that the cable from the wall to the router is pushed in firmly.',
      'If the internet light is red after a restart, a technician needs to look at the line.',
    ],
  },
  {
    id: 'kb-reset-password',
    title: 'Reset your account password',
    category: 'account_access',
    keywords: ['password', 'forgot', 'locked', 'login', 'log in', 'sign in', 'locked out'],
    steps: [
      'Go to acme internet dot example slash reset.',
      'Enter the email address on the account.',
      'Open the reset email and choose a new password.',
      'If the account is locked, wait 15 minutes before signing in again.',
    ],
  },
  {
    id: 'kb-duplicate-pending-charge',
    title: 'Duplicate or pending charges',
    category: 'billing',
    keywords: ['twice', 'double', 'duplicate', 'charged', 'pending', 'two charges', 'extra charge'],
    steps: [
      'A second charge is often a pending authorization from a payment retry.',
      'Pending authorizations drop off by themselves within 3 to 5 business days.',
      'If both charges have posted, not just pending, the billing team issues a refund.',
    ],
  },
  {
    id: 'kb-update-payment-method',
    title: 'Update your payment method',
    category: 'billing',
    keywords: ['card', 'payment method', 'expired', 'declined', 'autopay', 'unrecognized', 'bill'],
    steps: [
      'Sign in at acme internet dot example and open Billing.',
      'Choose Payment methods, then Add a card or bank account.',
      'Set the new method as the default for autopay.',
    ],
  },
  {
    id: 'kb-cancellation-policy',
    title: 'Cancellation policy and retention offer',
    category: 'cancel_service',
    keywords: ['cancel', 'cancellation', 'leave', 'too expensive', 'moving', 'switch', 'price'],
    steps: [
      'Before cancelling, eligible customers can get 3 months at half price, or a free upgrade to the next speed tier.',
      'Cancellation takes effect at the end of the billing cycle, with no early termination fee.',
      'Equipment must be returned within 30 days.',
    ],
  },
];

/** What the call keeps of an article: enough to walk the caller through it. */
export const articleSummary = (article: Article) => ({ id: article.id, title: article.title, steps: article.steps });

/**
 * Best article for the query: keyword hits, with a bonus for matching the category. `tried` lists the fixes the
 * caller already tried (details answered "yes"), so their articles are skipped.
 */
export function searchMockKnowledgeBase(query: { category?: unknown; query?: unknown; tried?: string[] }): Article | undefined {
  const text = typeof query.query === 'string' ? query.query.toLowerCase() : '';
  let best: { article: Article; score: number } | undefined;
  for (const article of ARTICLES) {
    if (article.triedWhen && query.tried?.includes(article.triedWhen)) continue;
    const hits = article.keywords.filter((keyword) => text.includes(keyword)).length;
    const score = hits * 2 + (article.category === query.category ? 3 : 0);
    if (score > 0 && (!best || score > best.score)) best = { article, score };
  }
  return best?.article;
}
