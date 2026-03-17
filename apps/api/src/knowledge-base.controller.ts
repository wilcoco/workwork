import { Body, Controller, Delete, Get, Param, Post, Put, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateKbDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() content!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() systemName?: string;
  @IsOptional() @IsString() manualId?: string;
}

class UpdateKbDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() systemName?: string;
}

@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('category') category?: string,
    @Query('systemName') systemName?: string,
    @Query('manualId') manualId?: string,
    @Query('q') q?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (category) where.category = category;
    if (systemName) where.systemName = systemName;
    if (manualId) where.manualId = manualId;
    if (q) where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
      { tags: { contains: q, mode: 'insensitive' } },
    ];
    const items = await this.prisma.knowledgeBase.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return { items };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id } });
    if (!kb) throw new NotFoundException('지식베이스 항목을 찾을 수 없습니다.');
    await this.prisma.knowledgeBase.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return kb;
  }

  @Post()
  async create(@Body() dto: CreateKbDto) {
    const uid = String(dto.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('user not found');

    const kb = await this.prisma.knowledgeBase.create({
      data: {
        userId: uid,
        title: dto.title,
        content: dto.content,
        category: dto.category || 'general',
        tags: dto.tags || '',
        systemName: dto.systemName || null,
        manualId: dto.manualId || null,
      },
    });
    return kb;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateKbDto) {
    const uid = String(dto.userId || '').trim();
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id } });
    if (!kb) throw new NotFoundException('지식베이스 항목을 찾을 수 없습니다.');
    if (kb.userId !== uid) throw new BadRequestException('소유자만 수정할 수 있습니다.');

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.systemName !== undefined) data.systemName = dto.systemName;
    if (Object.keys(data).length) data.version = { increment: 1 };

    const updated = await this.prisma.knowledgeBase.update({ where: { id }, data });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id } });
    if (!kb) throw new NotFoundException('지식베이스 항목을 찾을 수 없습니다.');
    if (userId && kb.userId !== userId) throw new BadRequestException('소유자만 삭제할 수 있습니다.');
    await this.prisma.knowledgeBase.delete({ where: { id } });
    return { ok: true };
  }

  // 매뉴얼에서 자동 등록
  @Post('from-manual/:manualId')
  async createFromManual(@Param('manualId') manualId: string, @Body() body: { userId: string }) {
    const uid = String(body.userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const manual = await this.prisma.workManual.findUnique({ where: { id: manualId } });
    if (!manual) throw new NotFoundException('매뉴얼을 찾을 수 없습니다.');

    const baseType = String(manual.baseType || '');
    const category = baseType === 'system_operation' ? 'system_operation'
                   : baseType === 'calculation' ? 'calculation'
                   : 'general';
    const phaseData = (manual.phaseData as any) || {};
    const systemName = phaseData?.phase1?.freeText?.match(/(?:ERP|MES|SAP|시스템|프로그램)\s*[:\-]?\s*(\S+)/i)?.[1] || null;

    const kb = await this.prisma.knowledgeBase.create({
      data: {
        userId: uid,
        manualId,
        title: manual.title + ' — 지식베이스',
        content: manual.content || '',
        category,
        systemName,
        tags: [baseType, manual.department || ''].filter(Boolean).join(','),
      },
    });
    return kb;
  }
}
