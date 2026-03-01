// ═══════════════════════════════════════════════════════════════
// PromptPay :: Telegram Channel
// Bot long-polling for Telegram messaging (sequential, no overlap)
// Uses node:https to avoid undici HTTP/2 session conflicts with Telegram API
// ═══════════════════════════════════════════════════════════════

import https from 'node:https';
import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class TelegramChannel extends BaseChannel {
  private lastUpdateId = 0;
  private running = false;
  private activeRequest: ReturnType<typeof https.get> | null = null;

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
      const result = await this.postTelegram('sendMessage', {
        chat_id: recipientId, text: content, parse_mode: 'Markdown',
      });

      if (!result.ok) {
        this.logger.error(`Telegram send failed: ${result.description || 'unknown'}`);
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

  async sendChatAction(chatId: string, action: string = 'typing'): Promise<void> {
    if (!CONFIG.telegram.botToken) return;
    try {
      await this.postTelegram('sendChatAction', { chat_id: chatId, action });
    } catch {}
  }

  async start(): Promise<void> {
    if (!CONFIG.telegram.botToken) {
      this.logger.warn('Telegram bot token not configured, channel disabled');
      return;
    }

    this.active = true;
    this.running = true;
    this.logger.info('Telegram channel started (long-polling)');
    this.pollLoop(); // fire-and-forget — runs until stop()
  }

  async stop(): Promise<void> {
    this.running = false;
    this.active = false;
    if (this.activeRequest) {
      this.activeRequest.destroy();
      this.activeRequest = null;
    }
  }

  /** POST to a Telegram Bot API method via node:https */
  private postTelegram(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
      const url = new URL(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/${method}`);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        agent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          agent.destroy();
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
        });
      });
      req.on('error', (err) => { agent.destroy(); reject(err); });
      req.write(payload);
      req.end();
    });
  }

  /** GET getUpdates via node:https with a fresh agent per request */
  private getUpdates(offset: number, timeout: number): Promise<{
    ok: boolean;
    description?: string;
    result: Array<{
      update_id: number;
      message?: { chat: { id: number }; text?: string; from?: { id: number; username?: string; first_name?: string } };
    }>;
  }> {
    return new Promise((resolve, reject) => {
      // Fresh agent per request — no shared TLS session cache. This prevents
      // Telegram from seeing overlapping sessions (which causes 409 Conflict).
      const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
      const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/getUpdates?offset=${offset}&timeout=${timeout}`;
      const req = https.get(url, { agent }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          agent.destroy();
          try { resolve(JSON.parse(body)); } catch { reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`)); }
        });
      });
      req.on('error', (err) => { agent.destroy(); reject(err); });
      this.activeRequest = req;
    });
  }

  /** Sequential long-poll loop — exactly one getUpdates at a time */
  private async pollLoop(): Promise<void> {
    // Use timeout=5 rather than 30. Telegram's long-poll with timeout≥30
    // triggers frequent 409 Conflict on Node.js even with fresh TCP sockets.
    // With timeout=5, 409s are rare and messages arrive within 5s max latency.
    const POLL_TIMEOUT = 5;

    while (this.running) {
      try {
        const data = await this.getUpdates(this.lastUpdateId + 1, POLL_TIMEOUT);

        if (!data.ok) {
          const desc = data.description || 'unknown';
          if (desc.includes('Conflict')) {
            // 409 — Telegram session overlap; harmless, just retry immediately.
            // No messages are lost; they'll be returned on the next successful poll.
            continue;
          }
          this.logger.warn(`Telegram poll error: ${desc}`);
          await this.sleep(3000);
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
        if (!errMsg.includes('ECONNRESET') && !errMsg.includes('socket hang up')) {
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
