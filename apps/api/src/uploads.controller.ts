import { BadRequestException, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';

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
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    const ext = extname(file.originalname || '');
    const filename = `${randomUUID()}${ext}`;

    // 1) Read bytes for DB persistence
    const data = file.buffer as any as Buffer | undefined;
    if (!data) throw new BadRequestException('unable to read uploaded file');

    // 2) Save to DB (Upload model)
    let rec: any;
    try {
      rec = await this.prisma.upload.create({
        data: {
          filename,
          originalName: file.originalname || null,
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
          originalName: file.originalname,
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
    return {
      url: dbUrl,
      name: file.originalname,
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
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(f.data as any));
  }
}
