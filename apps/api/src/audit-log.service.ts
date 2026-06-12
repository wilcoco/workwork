import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// 수정/삭제 감사 로그 — 기존 Event 테이블 재활용 (결재 모듈과 동일 패턴)
// activity 규약: <Subject>Updated / <Subject>Deleted, attrs에 before/after 또는 snapshot 저장
@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  /** 실패해도 본 작업을 막지 않는 best-effort 로깅 */
  async log(subjectType: string, subjectId: string, activity: string, userId?: string | null, attrs?: any) {
    try {
      await this.prisma.event.create({
        data: {
          subjectType,
          subjectId,
          activity,
          userId: userId || null,
          attrs: attrs ?? undefined,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[audit] log failed', { subjectType, subjectId, activity, e: String(e) });
    }
  }

  /** dto에 들어온 필드만 before/after로 추려 diff 생성 */
  diff(before: any, dto: any, keys: string[]): { before: any; after: any } {
    const b: any = {};
    const a: any = {};
    for (const k of keys) {
      if (dto[k] !== undefined) {
        b[k] = before?.[k] ?? null;
        a[k] = dto[k];
      }
    }
    return { before: b, after: a };
  }
}
