import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('brand')
export class BrandController {
  constructor(private config: ConfigService) {}

  @Get()
  get() {
    const raw = String(
      this.config.get('VITE_COMPANY_NAME') ||
      this.config.get('COMPANY_NAME') ||
      this.config.get('BRAND_COMPANY_NAME') ||
      ''
    )
      .trim()
      .replace(/^['"]+|['"]+$/g, '');

    const norm = raw.toLowerCase();
    const isCams = norm.includes('캠스') || norm.includes('cams');
    const isIat = norm.includes('아이앤테크') || norm.includes('i&tech') || norm.includes('iandtech');
    const logoPath = isCams ? '/camslogo.jpg' : isIat ? '/logo.png' : '/logo.png';

    return { name: raw || '회사', logoPath };
  }
}
