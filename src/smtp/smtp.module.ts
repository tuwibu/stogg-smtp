import { Module } from '@nestjs/common';
import { SmtpService } from './smtp.service';

@Module({
  providers: [SmtpService],
})
export class SmtpModule {}
