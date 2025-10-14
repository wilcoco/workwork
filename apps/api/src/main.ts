import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT || config.get('PORT') || 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API running on port ${port}`);
}
bootstrap();
