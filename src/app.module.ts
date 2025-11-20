import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { SmtpModule } from './smtp/smtp.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),
    SmtpModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
