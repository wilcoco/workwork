import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.use((req: any, res: any, next: any) => {
    try {
      const url = String(req.originalUrl || req.url || '');
      if (url.startsWith('/api/uploads')) {
        const rid = String(req.headers['x-railway-request-id'] || req.headers['x-request-id'] || randomUUID());
        const started = Date.now();
        try {
          console.log('[http] uploads start', {
            rid,
            method: req.method,
            url,
            origin: req.headers?.origin,
            contentType: req.headers?.['content-type'],
            contentLength: req.headers?.['content-length'],
          });
        } catch {}
        req.on('aborted', () => {
          try { console.log('[http] uploads aborted', { rid, ms: Date.now() - started }); } catch {}
        });
        req.on('close', () => {
          try { console.log('[http] uploads req close', { rid, ms: Date.now() - started }); } catch {}
        });
        res.on('finish', () => {
          try { console.log('[http] uploads finish', { rid, statusCode: res.statusCode, ms: Date.now() - started }); } catch {}
        });
        res.on('close', () => {
          try { console.log('[http] uploads res close', { rid, statusCode: res.statusCode, ms: Date.now() - started }); } catch {}
        });
      }
    } catch {}
    next();
  });

  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT || config.get('PORT') || 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API running on port ${port}`);
}
bootstrap();
