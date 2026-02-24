// ═══════════════════════════════════════════════════════════════
// PromptPay :: WhatsApp Channel (Twilio)
// Send/receive WhatsApp messages via Twilio WhatsApp API
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class WhatsAppChannel extends BaseChannel {
  constructor(logger: LoggerHandle) {
    super('whatsapp', logger);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      canSendText: true, canSendMedia: true, canCreatePolls: false,
      canReact: true, canThread: false, canVoice: false, maxMessageLength: 4096,
    };
  }

  async sendMessage(recipientId: string, content: string): Promise<boolean> {
    const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber } = CONFIG.sms;
    if (!twilioAccountSid || !twilioAuthToken) return false;

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
      const to = recipientId.startsWith('whatsapp:') ? recipientId : `whatsapp:${recipientId}`;
      const from = `whatsapp:${twilioPhoneNumber}`;

      const body = new URLSearchParams({ To: to, From: from, Body: content });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        this.logger.error(`WhatsApp send failed: ${response.statusText}`);
        return false;
      }

      const msg: ChannelMessage = {
        id: uuid(), channelType: 'whatsapp', direction: 'outbound',
        senderId: from, recipientId: to, content, metadata: {}, timestamp: new Date(),
      };
      this.emitMessage(msg);
      return true;
    } catch (err) {
      this.logger.error(`WhatsApp send error: ${err}`);
      return false;
    }
  }

  /** Handle inbound message from Twilio webhook */
  handleInbound(from: string, body: string, profileName?: string): void {
    const msg: ChannelMessage = {
      id: uuid(), channelType: 'whatsapp', direction: 'inbound',
      senderId: from.replace('whatsapp:', ''),
      recipientId: 'system', content: body,
      metadata: { profileName, rawFrom: from },
      timestamp: new Date(),
    };
    this.emitMessage(msg);
  }

  async start(): Promise<void> {
    if (CONFIG.sms.twilioAccountSid && CONFIG.sms.twilioAuthToken) {
      this.active = true;
      this.logger.info('WhatsApp channel active (Twilio)');
    } else {
      this.logger.warn('Twilio not configured, WhatsApp channel disabled');
    }
  }

  async stop(): Promise<void> {
    this.active = false;
  }
}
