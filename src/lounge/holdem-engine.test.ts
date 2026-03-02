import { describe, expect, it } from 'vitest';
import { buildSidePots, compareEvaluations, evaluateSevenCardHand } from './holdem-engine.js';
import type { HoldemCard, HoldemSeatState } from './holdem-types.js';

function card(code: string): HoldemCard {
  const rankMap: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const rankLabel = code[0];
  return {
    rank: rankMap[rankLabel] ?? Number(rankLabel),
    suit: code[1] as HoldemCard['suit'],
    code,
  };
}

describe('holdem-engine', () => {
  it('ranks straight flush above four of a kind', () => {
    const straightFlush = evaluateSevenCardHand([card('AS'), card('KS'), card('QS'), card('JS'), card('TS'), card('2D'), card('3C')]);
    const quads = evaluateSevenCardHand([card('AH'), card('AD'), card('AC'), card('AS'), card('2D'), card('3C'), card('4H')]);
    expect(compareEvaluations(straightFlush, quads)).toBe(1);
  });

  it('builds side pots from committed chips', () => {
    const seats = [
      { seatIndex: 0, committed: 50, folded: false },
      { seatIndex: 1, committed: 100, folded: false },
      { seatIndex: 2, committed: 100, folded: true },
    ] as HoldemSeatState[];
    expect(buildSidePots(seats)).toEqual([
      { amount: 150, eligibleSeatIndexes: [0, 1] },
      { amount: 100, eligibleSeatIndexes: [1] },
    ]);
  });
});
