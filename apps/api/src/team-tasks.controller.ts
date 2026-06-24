import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
const mammoth = require('mammoth');
const XLSX = require('xlsx');

type Attachment = { url?: string; name?: string; uploadId?: string };

@Controller('team-tasks')
export class TeamTasksController {
  constructor(private prisma: PrismaService) {}

  private async getVisibility(orgUnitId: string): Promise<'PUBLIC' | 'PRIVATE'> {
    const s = await (this.prisma as any).teamTaskSetting.findUnique({ where: { orgUnitId } }).catch(() => null);
    return (s?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC');
  }
  private isAdmin(user: any): boolean {
    const defaults = ['json@cams2002.onmicrosoft.com'];
    const envAdmins = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const set = new Set([...defaults, ...envAdmins]);
    const email = String(user?.email || '').toLowerCase();
    const upn = String(user?.teamsUpn || '').toLowerCase();
    return String(user?.role) === 'CEO' || set.has(email) || set.has(upn);
  }
  // 비공개(PRIVATE) 팀 과제는 해당 팀 구성원 또는 대표/관리자만 접근
  private async assertAccess(orgUnitId: string, userId?: string) {
    const vis = await this.getVisibility(orgUnitId);
    if (vis === 'PUBLIC') return;
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    const sameTeam = !!user?.orgUnitId && user.orgUnitId === orgUnitId;
    if (!(sameTeam || this.isAdmin(user))) throw new ForbiddenException('비공개 팀 과제입니다 (해당 팀 구성원/관리자만 접근)');
  }

  // 팀 과제 트리 (flat 목록 — 프론트에서 트리 구성)
  @Get()
  async list(@Query('orgUnitId') orgUnitId?: string, @Query('userId') userId?: string) {
    if (!orgUnitId) throw new BadRequestException('orgUnitId required');
    await this.assertAccess(orgUnitId, userId);
    const items = await (this.prisma as any).teamTaskNode.findMany({
      where: { orgUnitId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return { items };
  }

  // 사용자가 접근 가능한 팀 목록 (공개팀 전체 + 비공개팀은 본인팀/관리자만)
  @Get('accessible-teams')
  async accessibleTeams(@Query('userId') userId?: string) {
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    const teams = await this.prisma.orgUnit.findMany({ where: { type: 'TEAM' as any }, orderBy: { name: 'asc' } });
    const settings = await (this.prisma as any).teamTaskSetting.findMany();
    const visMap: Record<string, string> = {}; settings.forEach((s: any) => (visMap[s.orgUnitId] = s.visibility));
    const admin = this.isAdmin(user);
    const out = teams
      .map((t) => ({ id: t.id, name: t.name, visibility: (visMap[t.id] === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC') as 'PUBLIC' | 'PRIVATE' }))
      .filter((t) => t.visibility === 'PUBLIC' || admin || (!!user?.orgUnitId && user.orgUnitId === t.id));
    return { items: out, isAdmin: admin };
  }

  // 팀 공개/비공개 설정 (대표/관리자만)
  @Put('visibility')
  async setVisibility(@Body() dto: { orgUnitId?: string; visibility?: string; actorId?: string }) {
    if (!dto.orgUnitId) throw new BadRequestException('orgUnitId required');
    const user = dto.actorId ? await this.prisma.user.findUnique({ where: { id: dto.actorId } }) : null;
    if (!this.isAdmin(user)) throw new ForbiddenException('대표/관리자만 변경할 수 있습니다');
    const visibility = dto.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
    await (this.prisma as any).teamTaskSetting.upsert({ where: { orgUnitId: dto.orgUnitId }, create: { orgUnitId: dto.orgUnitId, visibility }, update: { visibility } });
    return { orgUnitId: dto.orgUnitId, visibility };
  }

  @Post()
  async create(@Body() dto: any) {
    if (!dto.orgUnitId || !String(dto.title || '').trim()) throw new BadRequestException('orgUnitId, title required');
    await this.assertAccess(dto.orgUnitId, dto.actorId);
    const node = await (this.prisma as any).teamTaskNode.create({
      data: {
        orgUnitId: dto.orgUnitId,
        parentId: dto.parentId || null,
        title: String(dto.title).trim(),
        order: typeof dto.order === 'number' ? dto.order : 0,
        milestoneDate: dto.milestoneDate ? new Date(dto.milestoneDate) : null,
        status: dto.status || null,
        prepNote: dto.prepNote ?? null,
        resultNote: dto.resultNote ?? null,
        attachments: Array.isArray(dto.attachments) ? dto.attachments : undefined,
        keyResultId: dto.keyResultId || null,
        objectiveId: dto.objectiveId || null,
        createdById: dto.actorId || null,
      },
    });
    return node;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    const exists = await (this.prisma as any).teamTaskNode.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException('not found');
    await this.assertAccess(exists.orgUnitId, dto.actorId);
    const data: any = {};
    if (typeof dto.title === 'string') data.title = dto.title.trim();
    if (typeof dto.order === 'number') data.order = dto.order;
    if ('milestoneDate' in dto) data.milestoneDate = dto.milestoneDate ? new Date(dto.milestoneDate) : null;
    if ('status' in dto) data.status = dto.status || null;
    if ('prepNote' in dto) data.prepNote = dto.prepNote ?? null;
    if ('resultNote' in dto) data.resultNote = dto.resultNote ?? null;
    if (Array.isArray(dto.attachments)) data.attachments = dto.attachments;
    if ('keyResultId' in dto) data.keyResultId = dto.keyResultId || null;
    if ('objectiveId' in dto) data.objectiveId = dto.objectiveId || null;
    const node = await (this.prisma as any).teamTaskNode.update({ where: { id }, data });
    return node;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const exists = await (this.prisma as any).teamTaskNode.findUnique({ where: { id } });
    if (exists) await this.assertAccess(exists.orgUnitId, userId);
    // 하위 노드는 FK Cascade로 함께 삭제
    await (this.prisma as any).teamTaskNode.delete({ where: { id } }).catch(() => {});
    return { ok: true };
  }

  // 팀 과제 자료 기반 AI 질의응답
  @Post('ask')
  async ask(@Body() dto: { orgUnitId?: string; question?: string; actorId?: string }) {
    if (!dto.orgUnitId) throw new BadRequestException('orgUnitId required');
    if (!String(dto.question || '').trim()) throw new BadRequestException('question required');
    await this.assertAccess(dto.orgUnitId, dto.actorId);

    const nodes = await (this.prisma as any).teamTaskNode.findMany({ where: { orgUnitId: dto.orgUnitId }, orderBy: [{ order: 'asc' }] });
    const byId: Record<string, any> = {}; nodes.forEach((n: any) => (byId[n.id] = n));
    const pathOf = (n: any): string => {
      const parts: string[] = []; let cur = n;
      while (cur) { parts.unshift(cur.title); cur = cur.parentId ? byId[cur.parentId] : null; }
      return parts.join(' > ');
    };

    // 과제 텍스트 + 첨부 파일 내용 수집
    const chunks: string[] = [];
    let attCount = 0;
    for (const n of nodes) {
      const lines = [`■ ${pathOf(n)}`];
      if (n.milestoneDate) lines.push(`  마일스톤: ${new Date(n.milestoneDate).toISOString().slice(0, 10)}${n.status ? ` (${n.status})` : ''}`);
      if (n.prepNote) lines.push(`  준비자료: ${n.prepNote}`);
      if (n.resultNote) lines.push(`  결과보고: ${n.resultNote}`);
      const atts: Attachment[] = Array.isArray(n.attachments) ? n.attachments : [];
      for (const a of atts.slice(0, 5)) {
        const uid = a.uploadId || this.uploadIdFromUrl(a.url);
        if (!uid) continue;
        const text = await this.extractUploadText(uid).catch(() => '');
        if (text) { attCount++; lines.push(`  [첨부:${a.name || ''}]\n${text.slice(0, 6000)}`); }
        else if (a.name) lines.push(`  [첨부:${a.name}] (본문 추출 불가)`);
      }
      chunks.push(lines.join('\n'));
    }
    const context = chunks.join('\n\n').slice(0, 120000);

    const system = '당신은 팀 과제/마일스톤 관리 자료를 분석하는 비서입니다. 제공된 과제 트리·준비자료·결과보고·첨부파일 내용을 근거로 한국어로 간결하고 정확하게 답하세요. 자료에 없으면 모른다고 하세요.';
    const user = `## 팀 과제 자료\n${context || '(자료 없음)'}\n\n## 질문\n${dto.question}`;
    const answer = await this.generate(system, user);
    return { answer, attachmentsRead: attCount, nodes: nodes.length };
  }

  private uploadIdFromUrl(url?: string): string | null {
    const m = String(url || '').match(/files\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  private async extractUploadText(uploadId: string): Promise<string> {
    const up = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!up) return '';
    const buf = Buffer.from(up.data as any);
    const name = String((up as any).originalName || up.filename || '').toLowerCase();
    const ct = String(up.contentType || '').toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    try {
      if (ext === 'docx' || ct.includes('wordprocessingml')) {
        const r = await mammoth.extractRawText({ buffer: buf });
        return String(r?.value || '');
      }
      if (ext === 'xlsx' || ext === 'xls' || ct.includes('spreadsheet') || ct.includes('excel')) {
        const wb = XLSX.read(buf, { type: 'buffer' });
        return wb.SheetNames.map((s: string) => `# ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join('\n').slice(0, 20000);
      }
      if (ext === 'pdf' || ct.includes('pdf')) {
        const pdf = require('pdf-parse');
        const r = await pdf(buf);
        return String(r?.text || '');
      }
      if (['txt', 'csv', 'md', 'json', 'log'].includes(ext) || ct.startsWith('text/')) {
        return buf.toString('utf8');
      }
    } catch { /* ignore extraction errors */ }
    return '';
  }

  // OpenAI(기본) → 실패 시 Claude. 자유 텍스트 답변.
  private async generate(system: string, user: string): Promise<string> {
    const f: any = (globalThis as any).fetch;
    const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (openaiKey) {
      try {
        const resp = await f('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1', max_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        });
        if (resp.ok) { const d = await resp.json(); const t = String(d?.choices?.[0]?.message?.content || '').trim(); if (t) return t; }
      } catch { /* fall through */ }
    }
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (anthKey) {
      const resp = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-opus-4-8', max_tokens: 3000, system, messages: [{ role: 'user', content: user }] }),
      });
      if (resp.ok) { const d = await resp.json(); const b = (d?.content || []).find((x: any) => x.type === 'text'); return String(b?.text || '').trim(); }
      const txt = await resp.text().catch(() => '');
      throw new BadRequestException(`AI 호출 실패: ${resp.status} ${txt.slice(0, 200)}`);
    }
    throw new BadRequestException('AI API 키가 설정되지 않았습니다.');
  }
}
