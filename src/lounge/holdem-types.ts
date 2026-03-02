export type HoldemSuit = 'S' | 'H' | 'D' | 'C';

export interface HoldemCard {
  rank: number;
  suit: HoldemSuit;
  code: string;
}

export type HoldemPhase =
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'complete';

export type HoldemActionType = 'fold' | 'check' | 'call' | 'raise';

export interface HoldemActionCommand {
  type: HoldemActionType;
  amount?: number;
}

export interface HoldemSeatState {
  seatIndex: number;
  userId: string;
  displayName: string;
  isBot: boolean;
  connected: boolean;
  stack: number;
  holeCards: HoldemCard[];
  committed: number;
  betThisRound: number;
  folded: boolean;
  allIn: boolean;
  actedThisRound: boolean;
  lastAction?: HoldemActionType;
  reconnectToken: string;
  avatarMood: 'idle' | 'thinking' | 'pleased' | 'annoyed' | 'bluffing';
}

export interface HoldemTableState {
  id: string;
  name: string;
  phase: HoldemPhase;
  handNumber: number;
  dealerSeatIndex: number;
  seats: Array<HoldemSeatState | null>;
  board: HoldemCard[];
  deck: HoldemCard[];
  pot: number;
  sidePots: Array<{ amount: number; eligibleSeatIndexes: number[] }>;
  currentBet: number;
  minRaise: number;
  actingSeatIndex: number | null;
  smallBlind: number;
  bigBlind: number;
  lastEventAt: number;
  handId?: string;
  showdownWinners?: Array<{ seatIndex: number; amount: number; handLabel: string }>;
}

export interface HoldemVisibleSeat {
  seatIndex: number;
  userId: string;
  displayName: string;
  isBot: boolean;
  connected: boolean;
  stack: number;
  committed: number;
  betThisRound: number;
  folded: boolean;
  allIn: boolean;
  lastAction?: HoldemActionType;
  holeCards: Array<HoldemCard | { hidden: true }>;
  avatarMood: HoldemSeatState['avatarMood'];
}

export interface HoldemVisibleState {
  tableId: string;
  phase: HoldemPhase;
  handNumber: number;
  dealerSeatIndex: number;
  actingSeatIndex: number | null;
  board: HoldemCard[];
  pot: number;
  sidePots: Array<{ amount: number; eligibleSeatIndexes: number[] }>;
  currentBet: number;
  minRaise: number;
  seats: Array<HoldemVisibleSeat | null>;
  availableActions: {
    canFold: boolean;
    canCheck: boolean;
    canCall: boolean;
    callAmount: number;
    minRaiseTo: number;
    maxRaiseTo: number;
  } | null;
  timeline: {
    eventType: string;
    ts: number;
    payload: Record<string, unknown>;
  } | null;
  showdownWinners?: HoldemTableState['showdownWinners'];
}

export interface HoldemEvaluation {
  category:
    | 'high-card'
    | 'pair'
    | 'two-pair'
    | 'three-of-a-kind'
    | 'straight'
    | 'flush'
    | 'full-house'
    | 'four-of-a-kind'
    | 'straight-flush';
  score: number[];
  label: string;
}
