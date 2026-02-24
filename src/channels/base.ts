// ═══════════════════════════════════════════════════════════════
// PromptPay :: Channel Base
// Abstract base class for messaging channels
// ═══════════════════════════════════════════════════════════════

import { EventEmitter } from 'eventemitter3';
import type { ChannelType, ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';

export abstract class BaseChannel extends EventEmitter {
  readonly channelType: ChannelType;
  protected logger: LoggerHandle;
  protected active = false;

  constructor(channelType: ChannelType, logger: LoggerHandle) {
    super();
    this.channelType = channelType;
    this.logger = logger;
  }

  abstract getCapabilities(): ChannelCapabilities;
  abstract sendMessage(recipientId: string, content: string, media?: { type: string; url: string }): Promise<boolean>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  isActive(): boolean {
    return this.active;
  }

  protected emitMessage(message: ChannelMessage): void {
    this.emit('message', message);
  }
}
