// ═══════════════════════════════════════════════════════════════
// PromptPay :: Telegram Channel
// Bot polling for Telegram messaging
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class TelegramChannel extends BaseChannel {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;

  constructor(logger: LoggerHandle) {
    super('telegram', logger);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      canSendText: true, canSendMedia: true, canCreatePolls: true,
      canReact: true, canThread: true, canVoice: false, maxMessageLength: 4096,
    };
  }

  async sendMessage(recipientId: string, content: string): Promise<boolean> {
    if (!CONFIG.telegram.botToken) return false;

    try {
      const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: recipientId, text: content, parse_mode: 'Markdown' }),
      });

      if (!response.ok) {
        this.logger.error(`Telegram send failed: ${response.statusText}`);
        return false;
      }

      const msg: ChannelMessage = {
        id: uuid(), channelType: 'telegram', direction: 'outbound',
        senderId: 'system', recipientId, content, metadata: {}, timestamp: new Date(),
      };
      this.emitMessage(msg);
      return true;
    } catch (err) {
      this.logger.error(`Telegram send error: ${err}`);
      return false;
    }
  }

  async start(): Promise<void> {
    if (!CONFIG.telegram.botToken) {
      this.logger.warn('Telegram bot token not configured, channel disabled');
      return;
    }

    this.active = true;
    this.pollInterval = setInterval(() => this.poll(), 3000);
    this.logger.info('Telegram channel started (polling)');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.active = false;
  }

  private polling = false;

  private async poll(): Promise<void> {
    if (this.polling) return; // prevent overlapping polls
    this.polling = true;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${CONFIG.telegram.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`,
        { signal: AbortSignal.timeout(15000) }
      );
      const data = await response.json() as {
        ok: boolean;
        description?: string;
        result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string; from?: { id: number; username?: string; first_name?: string } } }>;
      };

      if (!data.ok) {
        this.logger.warn(`Telegram poll error: ${data.description || 'unknown'}`);
        return;
      }

      for (const update of data.result) {
        this.lastUpdateId = update.update_id;
        if (update.message?.text) {
          const msg: ChannelMessage = {
            id: uuid(), channelType: 'telegram', direction: 'inbound',
            senderId: String(update.message.from?.id || update.message.chat.id),
            recipientId: 'system', content: update.message.text,
            metadata: {
              username: update.message.from?.username || update.message.from?.first_name,
              chatId: update.message.chat.id,
            },
            timestamp: new Date(),
          };
          this.logger.info(`Telegram message from ${msg.metadata.username} (${msg.metadata.chatId}): ${msg.content.slice(0, 60)}`);
          this.emitMessage(msg);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted') && !errMsg.includes('timeout')) {
        this.logger.warn(`Telegram poll exception: ${errMsg}`);
      }
    } finally {
      this.polling = false;
    }
  }
}
