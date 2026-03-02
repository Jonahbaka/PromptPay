import { randomInt } from 'crypto';
import type { HoldemCard, HoldemEvaluation, HoldemSeatState, HoldemSuit } from './holdem-types.js';

const SUITS: HoldemSuit[] = ['S', 'H', 'D', 'C'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function rankCode(rank: number): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  if (rank === 10) return 'T';
  return String(rank);
}

function rankName(rank: number): string {
  if (rank === 14) return 'Ace';
  if (rank === 13) return 'King';
  if (rank === 12) return 'Queen';
  if (rank === 11) return 'Jack';
  return String(rank);
}

export function createDeck(): HoldemCard[] {
  const deck: HoldemCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, code: `${rankCode(rank)}${suit}` });
    }
  }
  return deck;
}

export function shuffleDeck(deck: HoldemCard[]): HoldemCard[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      acc.push(items[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function findStraight(ranks: number[]): number | null {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniq[0] === 14) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i += 1) {
    let run = true;
    for (let j = 0; j < 4; j += 1) {
      if (uniq[i + j] - 1 !== uniq[i + j + 1]) {
        run = false;
        break;
      }
    }
    if (run) return uniq[i];
  }
  return null;
}

function evaluateFiveCardHand(cards: HoldemCard[]): HoldemEvaluation {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = findStraight(ranks);

  if (isFlush && straightHigh) {
    return { category: 'straight-flush', score: [8, straightHigh], label: `${rankName(straightHigh)}-high straight flush` };
  }
  if (groups[0][1] === 4) {
    return { category: 'four-of-a-kind', score: [7, groups[0][0], groups[1][0]], label: `Four of a kind, ${rankName(groups[0][0])}s` };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { category: 'full-house', score: [6, groups[0][0], groups[1][0]], label: `${rankName(groups[0][0])}s full of ${rankName(groups[1][0])}s` };
  }
  if (isFlush) {
    return { category: 'flush', score: [5, ...ranks], label: `${rankName(ranks[0])}-high flush` };
  }
  if (straightHigh) {
    return { category: 'straight', score: [4, straightHigh], label: `${rankName(straightHigh)}-high straight` };
  }
  if (groups[0][1] === 3) {
    return { category: 'three-of-a-kind', score: [3, groups[0][0], ...groups.slice(1).map(([rank]) => rank)], label: `Three of a kind, ${rankName(groups[0][0])}s` };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    return { category: 'two-pair', score: [2, highPair, lowPair, groups[2][0]], label: `Two pair, ${rankName(highPair)}s and ${rankName(lowPair)}s` };
  }
  if (groups[0][1] === 2) {
    return { category: 'pair', score: [1, groups[0][0], ...groups.slice(1).map(([rank]) => rank)], label: `Pair of ${rankName(groups[0][0])}s` };
  }
  return { category: 'high-card', score: [0, ...ranks], label: `${rankName(ranks[0])}-high` };
}

export function compareEvaluations(a: HoldemEvaluation, b: HoldemEvaluation): number {
  const max = Math.max(a.score.length, b.score.length);
  for (let i = 0; i < max; i += 1) {
    const av = a.score[i] ?? 0;
    const bv = b.score[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

export function evaluateSevenCardHand(cards: HoldemCard[]): HoldemEvaluation {
  let best: HoldemEvaluation | null = null;
  for (const combo of combinations(cards, 5)) {
    const evaluation = evaluateFiveCardHand(combo);
    if (!best || compareEvaluations(evaluation, best) > 0) best = evaluation;
  }
  return best ?? evaluateFiveCardHand(cards.slice(0, 5));
}

export function buildSidePots(seats: HoldemSeatState[]): Array<{ amount: number; eligibleSeatIndexes: number[] }> {
  const contenders = seats
    .filter((seat) => seat.committed > 0)
    .map((seat) => ({ seatIndex: seat.seatIndex, committed: seat.committed, folded: seat.folded }))
    .sort((a, b) => a.committed - b.committed);
  const pots: Array<{ amount: number; eligibleSeatIndexes: number[] }> = [];
  let previous = 0;

  while (contenders.length > 0) {
    const tier = contenders[0].committed;
    const layer = tier - previous;
    if (layer > 0) {
      pots.push({
        amount: Number((layer * contenders.length).toFixed(2)),
        eligibleSeatIndexes: contenders.filter((seat) => !seat.folded).map((seat) => seat.seatIndex),
      });
      previous = tier;
    }
    while (contenders.length > 0 && contenders[0].committed === tier) contenders.shift();
  }

  return pots;
}

export function resolveShowdown(seats: HoldemSeatState[], board: HoldemCard[]): Array<{ seatIndex: number; amount: number; handLabel: string }> {
  const pots = buildSidePots(seats);
  const payouts = new Map<number, { amount: number; handLabel: string }>();

  for (const pot of pots) {
    const eligible = pot.eligibleSeatIndexes
      .map((seatIndex) => seats.find((seat) => seat.seatIndex === seatIndex) ?? null)
      .filter((seat): seat is HoldemSeatState => !!seat);
    if (eligible.length === 0) continue;

    let bestEval = evaluateSevenCardHand([...eligible[0].holeCards, ...board]);
    let winners = [eligible[0]];
    for (const seat of eligible.slice(1)) {
      const evaluation = evaluateSevenCardHand([...seat.holeCards, ...board]);
      const comparison = compareEvaluations(evaluation, bestEval);
      if (comparison > 0) {
        bestEval = evaluation;
        winners = [seat];
      } else if (comparison === 0) {
        winners.push(seat);
      }
    }

    const share = Number((pot.amount / winners.length).toFixed(2));
    let assigned = 0;
    winners.forEach((winner, index) => {
      const amount = index === winners.length - 1 ? Number((pot.amount - assigned).toFixed(2)) : share;
      assigned += amount;
      const existing = payouts.get(winner.seatIndex);
      payouts.set(winner.seatIndex, {
        amount: Number(((existing?.amount ?? 0) + amount).toFixed(2)),
        handLabel: bestEval.label,
      });
    });
  }

  return [...payouts.entries()].map(([seatIndex, value]) => ({ seatIndex, ...value }));
}
