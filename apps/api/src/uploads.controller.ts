import { BadRequestException, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';

function ensureDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

@Controller()
export class UploadsController {
  constructor(private prisma: PrismaService) {}

  @Post('uploads')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
          ensureDir(dir);
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const base = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname || '');
          cb(null, base + ext);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    })
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    // 1) Read bytes for DB persistence (from disk storage path)
    const dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    const path = join(dir, file.filename);
    let data: Buffer | undefined;
    try {
      data = fs.readFileSync(path);
    } catch {
      data = file.buffer as any; // fallback when memory storage is used
    }
    if (!data) throw new BadRequestException('unable to read uploaded file');

    // 2) Save to DB (Upload model)
    const rec = await this.prisma.upload.create({
      data: {
        filename: file.filename,
        originalName: file.originalname || null,
        contentType: file.mimetype || null,
        size: file.size,
        data,
      } as any,
    });

    // 3) Return DB-backed URL by default (respect global prefix 'api')
    const basePath = process.env.PUBLIC_UPLOAD_BASE || '/api/files/';
    const prefix = basePath.endsWith('/') ? basePath : basePath + '/';
    const dbUrl = `${prefix}${encodeURIComponent(rec.id)}`;
    return {
      url: dbUrl,
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      filename: file.filename,
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
