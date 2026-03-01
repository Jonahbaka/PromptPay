// ═══════════════════════════════════════════════════════════════
// PromptPay :: Telegram Channel
// Bot long-polling for Telegram messaging (sequential, no overlap)
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class TelegramChannel extends BaseChannel {
  private lastUpdateId = 0;
  private running = false;
  private pollAbort: AbortController | null = null;

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

    // Clear any webhooks (polling and webhooks are mutually exclusive)
    try {
      await fetch(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: false }),
      });
    } catch (err) {
      this.logger.warn(`Telegram deleteWebhook failed: ${err}`);
    }

    this.active = true;
    this.running = true;
    this.logger.info('Telegram channel started (long-polling)');
    this.pollLoop(); // fire-and-forget — runs until stop()
  }

  async stop(): Promise<void> {
    this.running = false;
    this.active = false;
    // Abort any in-flight long-poll request so Telegram releases the session immediately
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  /** Sequential long-poll loop — only one getUpdates at a time, no overlap */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.pollAbort = new AbortController();
        const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: 5,
            allowed_updates: ['message'],
          }),
          signal: this.pollAbort.signal,
        });
        const data = await response.json() as {
          ok: boolean;
          description?: string;
          result: Array<{
            update_id: number;
            message?: { chat: { id: number }; text?: string; from?: { id: number; username?: string; first_name?: string } };
          }>;
        };

        if (!data.ok) {
          const desc = data.description || 'unknown';
          if (desc.includes('Conflict')) {
            // 409: Another getUpdates is active — just wait for it to complete
            // Do NOT call getUpdates here — that would create a second concurrent request
            this.logger.warn('Telegram 409 Conflict — waiting for session release...');
            await this.sleep(5000);
          } else {
            this.logger.warn(`Telegram poll error: ${desc}`);
            await this.sleep(3000);
          }
          continue;
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
            this.logger.info(`Telegram message from ${msg.metadata.username} (${msg.metadata.chatId}): ${msg.content.slice(0, 80)}`);
            this.emitMessage(msg);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!errMsg.includes('aborted') && !errMsg.includes('TimeoutError')) {
          this.logger.warn(`Telegram poll exception: ${errMsg}`);
        }
        await this.sleep(2000);
      }
    }
    this.logger.info('Telegram poll loop stopped');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
