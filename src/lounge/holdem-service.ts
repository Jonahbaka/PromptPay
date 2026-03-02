import { randomBytes } from 'crypto';
import { v4 as uuid } from 'uuid';
import type { WebSocket } from 'ws';
import { verifyToken } from '../auth/tokens.js';
import { CONFIG } from '../core/config.js';
import type { LoggerHandle } from '../core/types.js';
import type { MemoryStore } from '../memory/store.js';
import { buildSidePots, createDeck, resolveShowdown, shuffleDeck } from './holdem-engine.js';
import { decideBotAction } from './holdem-bot.js';
import type {
  HoldemActionCommand,
  HoldemSeatState,
  HoldemTableState,
  HoldemVisibleSeat,
  HoldemVisibleState,
} from './holdem-types.js';

type ClientSender = (payload: Record<string, unknown>) => void;

interface PokerClientSession {
  clientId: string;
  ws: WebSocket;
  send: ClientSender;
  userId?: string;
  displayName?: string;
  tableId?: string;
}

const BOT_USER_ID = 'poker-bot-nova';

export class HoldemService {
  private readonly db: ReturnType<MemoryStore['getDb']>;
  private readonly logger: LoggerHandle;
  private readonly clients = new Map<string, PokerClientSession>();
  private readonly tables = new Map<string, HoldemTableState>();
  private readonly timelines = new Map<string, { eventType: string; ts: number; payload: Record<string, unknown> }>();
  private readonly botTimers = new Map<string, NodeJS.Timeout>();

  constructor(memory: MemoryStore, logger: LoggerHandle) {
    this.db = memory.getDb();
    this.logger = logger;
    this.ensureSchema();
  }

  registerClient(clientId: string, ws: WebSocket, send: ClientSender): void {
    this.clients.set(clientId, { clientId, ws, send });
  }

  unregisterClient(clientId: string): void {
    const session = this.clients.get(clientId);
    if (session?.tableId && session.userId) {
      const table = this.tables.get(session.tableId);
      const seat = table?.seats.find((entry) => entry?.userId === session.userId) ?? null;
      if (seat) seat.connected = false;
      if (table) this.pushState(table);
    }
    this.clients.delete(clientId);
  }

  handleMessage(clientId: string, message: Record<string, unknown>): boolean {
    const session = this.clients.get(clientId);
    if (!session) return false;
    switch (message.type) {
      case 'auth':
        this.authenticate(session, String(message.token || ''));
        return true;
      case 'poker:join_table':
        this.joinQuickTable(session);
        return true;
      case 'poker:state':
        this.sendCurrentState(session);
        return true;
      case 'poker:action':
        this.performAction(session, {
          type: String(message.action || 'check') as HoldemActionCommand['type'],
          amount: message.amount == null ? undefined : Number(message.amount),
        });
        return true;
      case 'poker:reconnect':
        this.reconnect(session, String(message.tableId || ''));
        return true;
      default:
        return false;
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS poker_tables (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS poker_hands (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL,
        hand_number INTEGER NOT NULL,
        phase TEXT NOT NULL,
        board TEXT NOT NULL,
        winners TEXT DEFAULT '[]',
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS poker_hand_events (
        id TEXT PRIMARY KEY,
        hand_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        hand_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_poker_hands_table ON poker_hands(table_id, hand_number);
      CREATE INDEX IF NOT EXISTS idx_poker_events_hand ON poker_hand_events(hand_id, created_at);
    `);
  }

  private authenticate(session: PokerClientSession, token: string): void {
    const payload = verifyToken(token, CONFIG.auth.jwtSecret);
    if (!payload) {
      session.send({ type: 'poker:error', message: 'Invalid or expired token' });
      return;
    }
    const user = this.db.prepare('SELECT id, display_name, email FROM users WHERE id = ?').get(payload.userId) as
      | { id: string; display_name: string | null; email: string | null }
      | undefined;
    session.userId = payload.userId;
    session.displayName = user?.display_name || user?.email || 'Player';
    session.send({ type: 'poker:authenticated', userId: session.userId, displayName: session.displayName });
  }

  private reconnect(session: PokerClientSession, tableId: string): void {
    if (!session.userId) {
      session.send({ type: 'poker:error', message: 'Authenticate first' });
      return;
    }
    const table = this.tables.get(tableId);
    if (!table) {
      session.send({ type: 'poker:error', message: 'Table not found' });
      return;
    }
    const seat = table.seats.find((entry) => entry?.userId === session.userId) ?? null;
    if (!seat) {
      session.send({ type: 'poker:error', message: 'Seat not found' });
      return;
    }
    seat.connected = true;
    session.tableId = table.id;
    this.pushState(table);
  }

  private joinQuickTable(session: PokerClientSession): void {
    if (!session.userId) {
      session.send({ type: 'poker:error', message: 'Authenticate first' });
      return;
    }
    let table = [...this.tables.values()].find((entry) => entry.phase === 'waiting');
    if (!table) table = this.createTable('Nova Holdem');

    let seat = table.seats.find((entry) => entry?.userId === session.userId) ?? null;
    if (!seat) {
      const openSeatIndex = table.seats.findIndex((entry) => entry === null);
      if (openSeatIndex === -1) {
        session.send({ type: 'poker:error', message: 'Table is full' });
        return;
      }
      seat = {
        seatIndex: openSeatIndex,
        userId: session.userId,
        displayName: session.displayName || 'Player',
        isBot: false,
        connected: true,
        stack: 200,
        holeCards: [],
        committed: 0,
        betThisRound: 0,
        folded: false,
        allIn: false,
        actedThisRound: false,
        reconnectToken: randomBytes(16).toString('hex'),
        avatarMood: 'idle',
      };
      table.seats[openSeatIndex] = seat;
    } else {
      seat.connected = true;
      seat.displayName = session.displayName || seat.displayName;
    }

    session.tableId = table.id;
    this.ensureBotSeat(table);
    this.emitTimeline(table, 'TABLE_JOINED', { seatIndex: seat.seatIndex, userId: seat.userId, isBot: false });
    this.pushState(table);
    if (table.phase === 'waiting') this.startHand(table);
  }

  private createTable(name: string): HoldemTableState {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO poker_tables (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now);
    const table: HoldemTableState = {
      id,
      name,
      phase: 'waiting',
      handNumber: 0,
      dealerSeatIndex: 0,
      seats: [null, null],
      board: [],
      deck: [],
      pot: 0,
      sidePots: [],
      currentBet: 0,
      minRaise: 2,
      actingSeatIndex: null,
      smallBlind: 1,
      bigBlind: 2,
      lastEventAt: Date.now(),
    };
    this.tables.set(id, table);
    return table;
  }

  private ensureBotSeat(table: HoldemTableState): void {
    if (table.seats.find((entry) => entry?.isBot)) return;
    const emptySeatIndex = table.seats.findIndex((entry) => entry === null);
    if (emptySeatIndex === -1) return;
    table.seats[emptySeatIndex] = {
      seatIndex: emptySeatIndex,
      userId: BOT_USER_ID,
      displayName: 'NOVA',
      isBot: true,
      connected: true,
      stack: 200,
      holeCards: [],
      committed: 0,
      betThisRound: 0,
      folded: false,
      allIn: false,
      actedThisRound: false,
      reconnectToken: randomBytes(16).toString('hex'),
      avatarMood: 'idle',
    };
  }

  private startHand(table: HoldemTableState): void {
    const activeSeats = table.seats.filter((entry): entry is HoldemSeatState => !!entry && entry.stack > 0);
    if (activeSeats.length < 2) return;

    table.handNumber += 1;
    table.phase = 'preflop';
    table.board = [];
    table.pot = 0;
    table.sidePots = [];
    table.currentBet = table.bigBlind;
    table.minRaise = table.bigBlind;
    table.dealerSeatIndex = table.dealerSeatIndex === 0 ? 1 : 0;
    table.deck = shuffleDeck(createDeck());
    table.handId = uuid();
    table.showdownWinners = [];

    activeSeats.forEach((seat) => {
      seat.holeCards = [];
      seat.committed = 0;
      seat.betThisRound = 0;
      seat.folded = false;
      seat.allIn = false;
      seat.actedThisRound = false;
      seat.lastAction = undefined;
      seat.avatarMood = 'idle';
    });

    for (let round = 0; round < 2; round += 1) {
      for (let offset = 1; offset <= 2; offset += 1) {
        const seat = table.seats[(table.dealerSeatIndex + offset) % 2];
        if (seat) seat.holeCards.push(table.deck.shift()!);
      }
    }

    const smallBlindSeat = table.seats[table.dealerSeatIndex];
    const bigBlindSeat = table.seats[(table.dealerSeatIndex + 1) % 2];
    if (smallBlindSeat) this.postBlind(table, smallBlindSeat, table.smallBlind, 'small-blind');
    if (bigBlindSeat) this.postBlind(table, bigBlindSeat, table.bigBlind, 'big-blind');

    table.actingSeatIndex = table.dealerSeatIndex;
    this.db.prepare(
      'INSERT INTO poker_hands (id, table_id, hand_number, phase, board, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(table.handId, table.id, table.handNumber, table.phase, JSON.stringify(table.board), new Date().toISOString());

    this.emitTimeline(table, 'HAND_START', { handNumber: table.handNumber });
    this.emitTimeline(table, 'DEAL_PRIVATE_CARDS', {});
    this.pushState(table);
    this.queueBot(table);
  }

  private postBlind(table: HoldemTableState, seat: HoldemSeatState, amount: number, label: string): void {
    const blind = Math.min(amount, seat.stack);
    seat.stack = Number((seat.stack - blind).toFixed(2));
    seat.betThisRound = blind;
    seat.committed = blind;
    seat.allIn = seat.stack <= 0;
    table.pot = Number((table.pot + blind).toFixed(2));
    this.emitTimeline(table, 'ACTION_TAKEN', { seatIndex: seat.seatIndex, action: label, amount: blind });
  }

  private performAction(session: PokerClientSession, action: HoldemActionCommand): void {
    if (!session.userId || !session.tableId) {
      session.send({ type: 'poker:error', message: 'Join a table first' });
      return;
    }
    const table = this.tables.get(session.tableId);
    if (!table) {
      session.send({ type: 'poker:error', message: 'Table not found' });
      return;
    }
    const seat = table.seats.find((entry) => entry?.userId === session.userId) ?? null;
    if (!seat) {
      session.send({ type: 'poker:error', message: 'Seat not found' });
      return;
    }
    const error = this.applyAction(table, seat, action);
    if (error) {
      session.send({ type: 'poker:error', message: error });
      return;
    }
    this.pushState(table);
    this.queueBot(table);
  }

  private applyAction(table: HoldemTableState, seat: HoldemSeatState, action: HoldemActionCommand): string | null {
    if (table.actingSeatIndex !== seat.seatIndex) return 'Not your turn';
    if (seat.folded || seat.allIn) return 'Seat cannot act';

    const toCall = Math.max(0, table.currentBet - seat.betThisRound);
    if (action.type === 'fold') {
      seat.folded = true;
      seat.lastAction = 'fold';
      seat.actedThisRound = true;
      seat.avatarMood = 'annoyed';
      this.emitTimeline(table, 'ACTION_TAKEN', { seatIndex: seat.seatIndex, action: 'fold' });
      this.finishIfSinglePlayerLeft(table);
      return null;
    }
    if (action.type === 'check') {
      if (toCall !== 0) return 'Cannot check facing a bet';
      seat.lastAction = 'check';
      seat.actedThisRound = true;
      seat.avatarMood = 'idle';
      this.emitTimeline(table, 'ACTION_TAKEN', { seatIndex: seat.seatIndex, action: 'check' });
      this.advance(table);
      return null;
    }
    if (action.type === 'call') {
      const amount = Math.min(toCall, seat.stack);
      seat.stack = Number((seat.stack - amount).toFixed(2));
      seat.betThisRound = Number((seat.betThisRound + amount).toFixed(2));
      seat.committed = Number((seat.committed + amount).toFixed(2));
      seat.allIn = seat.stack <= 0;
      seat.lastAction = 'call';
      seat.actedThisRound = true;
      seat.avatarMood = 'thinking';
      table.pot = Number((table.pot + amount).toFixed(2));
      this.emitTimeline(table, 'ACTION_TAKEN', { seatIndex: seat.seatIndex, action: 'call', amount });
      this.advance(table);
      return null;
    }
    if (action.type === 'raise') {
      const raiseTo = Number(action.amount || 0);
      const minRaiseTo = table.currentBet + table.minRaise;
      if (!Number.isFinite(raiseTo) || raiseTo < minRaiseTo) return `Minimum raise is ${minRaiseTo}`;
      if (raiseTo > seat.stack + seat.betThisRound) return 'Raise exceeds stack';
      const amount = raiseTo - seat.betThisRound;
      seat.stack = Number((seat.stack - amount).toFixed(2));
      seat.betThisRound = Number((seat.betThisRound + amount).toFixed(2));
      seat.committed = Number((seat.committed + amount).toFixed(2));
      seat.allIn = seat.stack <= 0;
      seat.lastAction = 'raise';
      seat.actedThisRound = true;
      seat.avatarMood = 'bluffing';
      table.pot = Number((table.pot + amount).toFixed(2));
      table.minRaise = raiseTo - table.currentBet;
      table.currentBet = raiseTo;
      table.seats.forEach((entry) => {
        if (entry && entry.userId !== seat.userId && !entry.folded && !entry.allIn) entry.actedThisRound = false;
      });
      this.emitTimeline(table, 'ACTION_TAKEN', { seatIndex: seat.seatIndex, action: 'raise', amount: raiseTo });
      this.advance(table);
      return null;
    }
    return 'Unsupported action';
  }

  private finishIfSinglePlayerLeft(table: HoldemTableState): void {
    const contenders = table.seats.filter((entry): entry is HoldemSeatState => !!entry && !entry.folded);
    if (contenders.length !== 1) {
      this.advance(table);
      return;
    }
    const winner = contenders[0];
    winner.stack = Number((winner.stack + table.pot).toFixed(2));
    table.showdownWinners = [{ seatIndex: winner.seatIndex, amount: table.pot, handLabel: 'Opponent folded' }];
    this.emitTimeline(table, 'POT_AWARDED', { winners: table.showdownWinners });
    this.completeHand(table);
  }

  private advance(table: HoldemTableState): void {
    if (this.maybeAdvanceStreet(table)) return;
    const nextSeat = table.seats.find((entry) => entry && !entry.folded && !entry.allIn && entry.seatIndex !== table.actingSeatIndex) ?? null;
    table.actingSeatIndex = nextSeat?.seatIndex ?? null;
  }

  private maybeAdvanceStreet(table: HoldemTableState): boolean {
    const activeSeats = table.seats.filter((entry): entry is HoldemSeatState => !!entry && !entry.folded);
    const bettingDone = activeSeats.every((seat) => seat.allIn || (seat.actedThisRound && seat.betThisRound === table.currentBet));
    if (!bettingDone) return false;

    const allInShowdown = activeSeats.every((seat) => seat.allIn);
    if (table.phase === 'river' || allInShowdown) {
      while (table.board.length < 5) {
        table.deck.shift();
        table.board.push(table.deck.shift()!);
      }
      table.phase = 'showdown';
      this.emitTimeline(table, 'SHOWDOWN', { board: table.board });
      table.sidePots = buildSidePots(activeSeats);
      table.showdownWinners = resolveShowdown(activeSeats, table.board);
      table.showdownWinners.forEach((winner) => {
        const seat = table.seats[winner.seatIndex];
        if (seat) seat.stack = Number((seat.stack + winner.amount).toFixed(2));
      });
      this.emitTimeline(table, 'POT_AWARDED', { winners: table.showdownWinners });
      this.completeHand(table);
      return true;
    }

    table.seats.forEach((entry) => {
      if (entry) {
        entry.betThisRound = 0;
        entry.actedThisRound = false;
      }
    });
    table.currentBet = 0;
    table.minRaise = table.bigBlind;

    if (table.phase === 'preflop') {
      table.deck.shift();
      table.board.push(table.deck.shift()!, table.deck.shift()!, table.deck.shift()!);
      table.phase = 'flop';
      this.emitTimeline(table, 'FLOP_REVEAL', { board: table.board });
    } else if (table.phase === 'flop') {
      table.deck.shift();
      table.board.push(table.deck.shift()!);
      table.phase = 'turn';
      this.emitTimeline(table, 'TURN_REVEAL', { board: table.board });
    } else if (table.phase === 'turn') {
      table.deck.shift();
      table.board.push(table.deck.shift()!);
      table.phase = 'river';
      this.emitTimeline(table, 'RIVER_REVEAL', { board: table.board });
    }
    table.actingSeatIndex = (table.dealerSeatIndex + 1) % 2;
    return true;
  }

  private completeHand(table: HoldemTableState): void {
    table.phase = 'complete';
    table.actingSeatIndex = null;
    this.db.prepare('UPDATE poker_hands SET phase = ?, board = ?, winners = ?, ended_at = ? WHERE id = ?').run(
      table.phase,
      JSON.stringify(table.board),
      JSON.stringify(table.showdownWinners ?? []),
      new Date().toISOString(),
      table.handId,
    );
    this.pushState(table);
    setTimeout(() => {
      table.phase = 'waiting';
      this.pushState(table);
      this.startHand(table);
    }, 3000);
  }

  private queueBot(table: HoldemTableState): void {
    const actingSeat = table.actingSeatIndex == null ? null : table.seats[table.actingSeatIndex];
    if (!actingSeat?.isBot || table.phase === 'complete' || table.phase === 'waiting') return;
    const previous = this.botTimers.get(table.id);
    if (previous) clearTimeout(previous);
    actingSeat.avatarMood = 'thinking';
    this.pushState(table);
    const timer = setTimeout(() => {
      const decision = decideBotAction(table, actingSeat);
      actingSeat.avatarMood = decision.mood;
      this.emitTimeline(table, 'AVATAR_CUE', { seatIndex: actingSeat.seatIndex, mood: decision.mood, voiceLine: decision.voiceLine });
      this.applyAction(table, actingSeat, decision.action);
      this.pushState(table);
      this.queueBot(table);
    }, 900 + Math.floor(Math.random() * 900));
    this.botTimers.set(table.id, timer);
  }

  private sendCurrentState(session: PokerClientSession): void {
    if (!session.userId || !session.tableId) return;
    const table = this.tables.get(session.tableId);
    if (!table) return;
    session.send({ type: 'poker:state', state: this.buildVisibleState(table, session.userId) });
  }

  private pushState(table: HoldemTableState): void {
    for (const session of this.clients.values()) {
      if (!session.userId || session.tableId !== table.id) continue;
      session.send({ type: 'poker:state', state: this.buildVisibleState(table, session.userId) });
    }
  }

  private emitTimeline(table: HoldemTableState, eventType: string, payload: Record<string, unknown>): void {
    const entry = { eventType, ts: Date.now(), payload };
    table.lastEventAt = entry.ts;
    this.timelines.set(table.id, entry);
    if (table.handId) {
      this.db.prepare(
        'INSERT INTO poker_hand_events (id, hand_id, table_id, hand_number, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuid(), table.handId, table.id, table.handNumber, eventType, JSON.stringify(payload), new Date(entry.ts).toISOString());
    }
  }

  private buildVisibleState(table: HoldemTableState, viewerUserId: string): HoldemVisibleState {
    const seats: Array<HoldemVisibleSeat | null> = table.seats.map((seat) => {
      if (!seat) return null;
      const showCards = seat.userId === viewerUserId || table.phase === 'showdown' || table.phase === 'complete';
      return {
        seatIndex: seat.seatIndex,
        userId: seat.userId,
        displayName: seat.displayName,
        isBot: seat.isBot,
        connected: seat.connected,
        stack: seat.stack,
        committed: seat.committed,
        betThisRound: seat.betThisRound,
        folded: seat.folded,
        allIn: seat.allIn,
        lastAction: seat.lastAction,
        holeCards: showCards ? seat.holeCards : [{ hidden: true }, { hidden: true }],
        avatarMood: seat.avatarMood,
      };
    });
    const viewerSeat = table.seats.find((seat) => seat?.userId === viewerUserId) ?? null;
    const callAmount = viewerSeat ? Math.max(0, table.currentBet - viewerSeat.betThisRound) : 0;
    const availableActions = viewerSeat && table.actingSeatIndex === viewerSeat.seatIndex
      ? {
          canFold: true,
          canCheck: callAmount === 0,
          canCall: callAmount > 0,
          callAmount,
          minRaiseTo: table.currentBet + table.minRaise,
          maxRaiseTo: viewerSeat.stack + viewerSeat.betThisRound,
        }
      : null;

    return {
      tableId: table.id,
      phase: table.phase,
      handNumber: table.handNumber,
      dealerSeatIndex: table.dealerSeatIndex,
      actingSeatIndex: table.actingSeatIndex,
      board: table.board,
      pot: table.pot,
      sidePots: table.sidePots,
      currentBet: table.currentBet,
      minRaise: table.minRaise,
      seats,
      availableActions,
      timeline: this.timelines.get(table.id) ?? null,
      showdownWinners: table.showdownWinners,
    };
  }
}
