import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import axios from 'axios'

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  private smtpServer!: SMTPServer
  private readonly logger = new Logger(SmtpService.name)
  private readonly multimailApiUrl: string
  private readonly multimailApiKey: string

  constructor(private readonly config: ConfigService) {
    this.multimailApiUrl = this.config.get<string>('MULTIMAIL_API_URL') || ''
    this.multimailApiKey = this.config.get<string>('MULTIMAIL_API_KEY') || ''
  }

  async onModuleInit() {
    this.startSmtpServer()
  }

  async onModuleDestroy() {
    if (this.smtpServer) {
      this.smtpServer.close()
    }
  }

  private parseAppleHideEmail(hideEmail: string): string | null {
    try {
      const emailMatch = hideEmail.match(/<(.+?)>/)
      const email = emailMatch ? emailMatch[1] : hideEmail.trim()

      const parts = email.split('@')
      if (parts.length !== 2 || parts[1] !== 'icloud.com') {
        return null
      }

      const prefix = parts[0]
      const atIndex = prefix.indexOf('_at_')

      if (atIndex === -1) return null

      const localPart = prefix.substring(0, atIndex)
      const afterAt = prefix.substring(atIndex + 4)
      const domainParts = afterAt.split('_')

      if (domainParts.length < 3) return null

      const domain = domainParts.slice(0, -2).join('.').replace(/_/g, '.')

      return `${localPart}@${domain}`
    } catch {
      return null
    }
  }

  private startSmtpServer() {
    const port = this.config.get<number>('SMTP_PORT') || 25
    const host = this.config.get<string>('SMTP_HOST') || '0.0.0.0'
    const maxSize = this.config.get<number>('SMTP_MAX_SIZE') || 10485760 // 10MB

    this.smtpServer = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      size: maxSize,
      banner: 'SMTP Server Ready',
      onConnect: (session, callback) => {
        this.logger.log(`Connection from ${session.remoteAddress}:${session.remotePort}`)
        callback()
      },
      onData: async (stream, session, callback) => {
        try {
          const parsed = await simpleParser(stream)

          const to = this.getFirstEmailAddress(parsed.to)
          const fromRaw = parsed.from?.text || ''
          const from = this.parseAppleHideEmail(fromRaw) || fromRaw
          const subject = parsed.subject || ''
          const body = parsed.text || ''
          const html = parsed.html ? String(parsed.html) : undefined
          if (from.includes('@apple.com')) {
            this.logger.log(`Email processed - From: ${from}, To: ${to}, Subject: ${subject}, Body: ${body}`)
          } else {
            this.logger.log(`Email processed - From: ${from}, To: ${to}, Subject: ${subject}`)
          }

          // multimail-api PushEmailDto shape: { to, from, subject?, body?, raw_data? }
          const url = `${this.multimailApiUrl}/api/emails`
          try {
            const res = await axios.post(
              url,
              { to, from, subject, body, raw_data: html },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': this.multimailApiKey,
                },
              },
            )
            this.logger.log(`[multimail] POST ${url} -> ${res.status} ${JSON.stringify(res.data)}`)
          } catch (ex: any) {
            const status = ex?.response?.status ?? 'NO_RESPONSE'
            const data = ex?.response?.data ?? ex?.message ?? 'unknown'
            this.logger.error(`[multimail] POST ${url} -> ${status} ${JSON.stringify(data)}`)
          }

          callback()
        } catch (error) {
          this.logger.error('Error processing email:', error)
          callback(new Error('Failed to process email'))
        }
      },
      onAuth: (auth, session, callback) => {
        callback(null, { user: 'anonymous' })
      },
    })

    this.smtpServer.listen(port, host, () => {
      this.logger.log(`SMTP Server listening on ${host}:${port}`)
    })

    this.smtpServer.on('error', (err) => {
      this.logger.error('SMTP Server error:', err)
    })
  }

  private getFirstEmailAddress(addressObj: any): string {
    if (!addressObj) return ''

    if (Array.isArray(addressObj)) {
      return addressObj[0]?.address || ''
    }

    if (addressObj.value && Array.isArray(addressObj.value)) {
      return addressObj.value[0]?.address || ''
    }

    return addressObj.text || ''
  }
}
