// ═══════════════════════════════════════════════════════════════
// PromptPay :: Channel Manager
// Registry and router for messaging channels
// ═══════════════════════════════════════════════════════════════

import { EventEmitter } from 'eventemitter3';
import type { ChannelType, ChannelMessage, LoggerHandle } from '../core/types.js';
import { BaseChannel } from './base.js';

export class ChannelManager extends EventEmitter {
  private channels: Map<ChannelType, BaseChannel> = new Map();
  private logger: LoggerHandle;

  constructor(logger: LoggerHandle) {
    super();
    this.logger = logger;
  }

  register(channel: BaseChannel): void {
    this.channels.set(channel.channelType, channel);
    channel.on('message', (msg: ChannelMessage) => {
      this.emit('message', msg);
    });
    this.logger.info(`Channel registered: ${channel.channelType}`);
  }

  async sendMessage(channelType: ChannelType, recipientId: string, content: string): Promise<boolean> {
    const channel = this.channels.get(channelType);
    if (!channel || !channel.isActive()) {
      this.logger.warn(`Channel ${channelType} not available`);
      return false;
    }
    return channel.sendMessage(recipientId, content);
  }

  async startAll(): Promise<void> {
    for (const [type, channel] of this.channels) {
      try {
        await channel.start();
        this.logger.info(`Channel started: ${type}`);
      } catch (err) {
        this.logger.error(`Channel ${type} failed to start: ${err}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [type, channel] of this.channels) {
      try {
        await channel.stop();
        this.logger.info(`Channel stopped: ${type}`);
      } catch (err) {
        this.logger.error(`Channel ${type} failed to stop: ${err}`);
      }
    }
  }

  getStatus(): Array<{ channel: ChannelType; active: boolean }> {
    return Array.from(this.channels.entries()).map(([type, ch]) => ({
      channel: type, active: ch.isActive(),
    }));
  }
}
