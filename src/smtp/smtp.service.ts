import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import axios from 'axios';

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  private smtpServer: SMTPServer;
  private readonly logger = new Logger(SmtpService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get<string>('API_URL') || '';
    this.apiKey = this.config.get<string>('API_KEY') || '';
  }

  async onModuleInit() {
    this.startSmtpServer();
  }

  async onModuleDestroy() {
    if (this.smtpServer) {
      this.smtpServer.close();
    }
  }

  private startSmtpServer() {
    const port = this.config.get<number>('SMTP_PORT') || 25;
    const host = this.config.get<string>('SMTP_HOST') || '0.0.0.0';
    const maxSize = this.config.get<number>('SMTP_MAX_SIZE') || 10485760; // 10MB

    this.smtpServer = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      size: maxSize,
      banner: 'SMTP Server Ready',
      onConnect: (session, callback) => {
        this.logger.log(`Connection from ${session.remoteAddress}:${session.remotePort}`);
        callback();
      },
      onData: async (stream, session, callback) => {
        try {
          const parsed = await simpleParser(stream);

          const to = this.getFirstEmailAddress(parsed.to);
          const from = parsed.from?.text || '';
          const subject = parsed.subject || '';
          const body = parsed.text || '';
          const html = parsed.html ? String(parsed.html) : undefined;
          const attachments = parsed.attachments || [];

          const payload = {
            from,
            to,
            subject,
            body,
            html,
            attachments: attachments.map((att) => ({
              filename: att.filename || 'unknown',
              size: att.size,
              contentType: att.contentType,
            })),
          };

          // Send to API using axios
          const response = await axios.put(this.apiUrl, payload, {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
            },
          });

          this.logger.log(`Email processed - From: ${from}, To: ${to}, Subject: ${subject}`);
          this.logger.debug(`API Response: ${JSON.stringify(response.data)}`);

          callback();
        } catch (error) {
          this.logger.error('Error processing email:', error);
          callback(new Error('Failed to process email'));
        }
      },
      onAuth: (auth, session, callback) => {
        callback(null, { user: 'anonymous' });
      },
    });

    this.smtpServer.listen(port, host, () => {
      this.logger.log(`SMTP Server listening on ${host}:${port}`);
    });

    this.smtpServer.on('error', (err) => {
      this.logger.error('SMTP Server error:', err);
    });
  }

  private getFirstEmailAddress(addressObj: any): string {
    if (!addressObj) return '';

    if (Array.isArray(addressObj)) {
      return addressObj[0]?.address || '';
    }

    if (addressObj.value && Array.isArray(addressObj.value)) {
      return addressObj.value[0]?.address || '';
    }

    return addressObj.text || '';
  }
}
