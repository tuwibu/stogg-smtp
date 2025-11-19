import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['log', 'error', 'warn'],
    });

    const logger = new Logger('SmtpWorker');
    logger.log('SMTP Worker started successfully');

    process.on('SIGINT', async () => {
      logger.log('Shutting down SMTP worker...');
      await app.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.log('Shutting down SMTP worker...');
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    Logger.error('Failed to start SMTP worker:', error);
    process.exit(1);
  }
}

bootstrap();
