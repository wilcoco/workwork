import { BadRequestException, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { Public } from './jwt-auth.guard';

@Public()
@Controller()
export class UploadsController {
  constructor(private prisma: PrismaService) {}

  @Post('uploads')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    })
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    const rid = String((req as any)?.headers?.['x-railway-request-id'] || (req as any)?.headers?.['x-request-id'] || '');
    const started = Date.now();
    if (!file) throw new BadRequestException('file is required');
    // Prefer explicit originalName field from frontend (always correct UTF-8)
    // Fallback: Multer decodes originalname as latin1 — re-decode to UTF-8
    const bodyName = String((req.body as any)?.originalName || '').trim();
    let origName = bodyName || file.originalname || '';
    if (!bodyName && origName) {
      try { origName = Buffer.from(origName, 'latin1').toString('utf8'); } catch {}
    }
    const ext = extname(origName);
    const filename = `${randomUUID()}${ext}`;

    try {
      console.log('[uploads] handler start', {
        rid,
        originalName: origName,
        contentType: file.mimetype,
        size: file.size,
      });
    } catch {}

    // 1) Read bytes for DB persistence
    const data = file.buffer as any as Buffer | undefined;
    if (!data) throw new BadRequestException('unable to read uploaded file');

    // 2) Save to DB (Upload model)
    let rec: any;
    try {
      rec = await this.prisma.upload.create({
        data: {
          filename,
          originalName: origName || null,
          contentType: file.mimetype || null,
          size: file.size,
          data,
        } as any,
      });
    } catch (e) {
      try {
        console.error('[uploads] create failed', {
          message: (e as any)?.message,
          code: (e as any)?.code,
          rid,
          originalName: origName,
          contentType: file.mimetype,
          size: file.size,
        });
      } catch {}
      throw new BadRequestException('upload failed');
    }

    // 3) Return DB-backed URL by default (respect global prefix 'api')
    const basePath = process.env.PUBLIC_UPLOAD_BASE || '/api/files/';
    const prefix = basePath.endsWith('/') ? basePath : basePath + '/';
    const dbUrl = `${prefix}${encodeURIComponent(rec.id)}`;
    try {
      console.log('[uploads] handler ok', { rid, uploadId: rec.id, ms: Date.now() - started });
    } catch {}
    return {
      url: dbUrl,
      name: origName,
      size: file.size,
      type: file.mimetype,
      filename,
    };
  }

  @Get('files/:id')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const f = await this.prisma.upload.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ message: 'Not Found' });
    if (f.contentType) res.setHeader('Content-Type', f.contentType);
    if ((f as any).originalName) {
      const encoded = encodeURIComponent(String((f as any).originalName));
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encoded}`);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(f.data as any));
  }
}
