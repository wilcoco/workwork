import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';

function ensureDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

@Controller('uploads')
export class UploadsController {
  @Post()
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
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    const basePath = process.env.PUBLIC_UPLOAD_BASE || '/uploads/';
    const prefix = basePath.endsWith('/') ? basePath : basePath + '/';
    return {
      url: prefix + encodeURIComponent(file.filename),
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      filename: file.filename,
    };
  }
}
