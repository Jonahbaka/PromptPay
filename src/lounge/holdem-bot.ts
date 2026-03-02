import { evaluateSevenCardHand } from './holdem-engine.js';
import type { HoldemActionCommand, HoldemCard, HoldemSeatState, HoldemTableState } from './holdem-types.js';

function preflopStrength(cards: HoldemCard[]): number {
  const [a, b] = cards.slice().sort((left, right) => right.rank - left.rank);
  let score = a.rank + b.rank;
  if (a.rank === b.rank) score += 18;
  if (a.suit === b.suit) score += 3;
  if (Math.abs(a.rank - b.rank) <= 2) score += 2;
  if (a.rank >= 12) score += 2;
  return score;
}

export function decideBotAction(table: HoldemTableState, seat: HoldemSeatState): {
  action: HoldemActionCommand;
  mood: HoldemSeatState['avatarMood'];
  voiceLine: string;
} {
  const toCall = Math.max(0, table.currentBet - seat.betThisRound);
  const boardCount = table.board.length;
  let strength = preflopStrength(seat.holeCards);

  if (boardCount >= 3) {
    const evalResult = evaluateSevenCardHand([...seat.holeCards, ...table.board]);
    strength = evalResult.score[0] * 25 + (evalResult.score[1] ?? 0);
  }

  if (toCall >= seat.stack) {
    if (strength >= 28) {
      return {
        action: { type: 'call' },
        mood: 'bluffing',
        voiceLine: 'All in. Let the river decide.',
      };
    }
    return {
      action: { type: 'fold' },
      mood: 'annoyed',
      voiceLine: 'Not worth the stack.',
    };
  }

  if (strength >= 34 && seat.stack > toCall + table.bigBlind) {
    const raiseTo = Math.min(seat.stack + seat.betThisRound, Math.max(table.currentBet + table.minRaise, table.currentBet + table.bigBlind * 2));
    return {
      action: { type: 'raise', amount: raiseTo },
      mood: 'bluffing',
      voiceLine: 'Pressure applied.',
    };
  }

  if (strength >= 24) {
    return {
      action: toCall > 0 ? { type: 'call' } : { type: 'check' },
      mood: 'thinking',
      voiceLine: toCall > 0 ? 'I can continue.' : 'I will take the free card.',
    };
  }

  if (toCall === 0) {
    return {
      action: { type: 'check' },
      mood: 'idle',
      voiceLine: 'Your move.',
    };
  }

  if (toCall <= table.bigBlind && strength >= 18) {
    return {
      action: { type: 'call' },
      mood: 'thinking',
      voiceLine: 'A small price for more information.',
    };
  }

  return {
    action: { type: 'fold' },
    mood: 'annoyed',
    voiceLine: 'This hand is beneath me.',
  };
}
