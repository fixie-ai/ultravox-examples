import { describe, expect, it } from 'vitest';
import { supportScenario } from '../../../agent';
import { ANY_STATE_NODE, buildGraphModel } from './graphModel';
import { summarizePath, TimelineEvent } from '../../shared/callModel';

describe('buildGraphModel', () => {
  const { nodes, edges } = buildGraphModel(supportScenario);

  it('has a node per state plus one for global actions', () => {
    expect(nodes.map((node) => node.id)).toEqual([...Object.keys(supportScenario.states), ANY_STATE_NODE]);
    expect(nodes.find((node) => node.id === 'call_ended')?.terminal).toBe(true);
  });

  it('lists self-loops on the node instead of drawing them', () => {
    expect(nodes.find((node) => node.id === 'identify_account')?.loops).toEqual(['account_not_found']);
    expect(edges.some((edge) => edge.source === edge.target)).toBe(false);
  });

  it('merges actions that lead to the same state into one edge', () => {
    expect(edges.find((edge) => edge.id === 'identify_account->classify_issue')?.label).toBe('account_verified / continue_unverified');
  });

  it('draws global actions from the "any state" node', () => {
    expect(edges.filter((edge) => edge.global)).toEqual([
      expect.objectContaining({ source: ANY_STATE_NODE, target: 'escalate', label: 'request_human' }),
    ]);
  });
});

describe('summarizePath', () => {
  const events: TimelineEvent[] = [
    {
      id: 'e2',
      at: 300,
      kind: 'transition',
      by: 'agent (updateState)',
      steps: [
        { from: 'greeting', action: 'issue_stated', to: 'identify_account', automatic: false },
        { from: 'identify_account', action: 'account_verified', to: 'classify_issue', automatic: true },
        { from: 'classify_issue', action: 'issue_classified', to: 'collect_details', automatic: true },
      ],
    },
  ];

  it('summarizes the path, marking states skipped by autoAdvance', () => {
    const { visits, takenEdges, takenActions } = summarizePath('greeting', events);
    expect(visits).toEqual([
      { state: 'greeting', order: 1, skipped: false },
      { state: 'identify_account', order: 2, skipped: true },
      { state: 'classify_issue', order: 3, skipped: true },
      { state: 'collect_details', order: 4, skipped: false },
    ]);
    expect([...takenEdges]).toContain('classify_issue->collect_details');
    expect(takenActions.has('account_verified')).toBe(true);
  });
});
