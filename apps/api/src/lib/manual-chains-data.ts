/**
 * 매뉴얼 간 선행→후행 업무 체인 (2026-11-02 AI 전수 추출 — 생성물, 재추출 시 전체 재생성).
 * from의 산출물이 to의 입력이 되는 관계만. why = 짧은 근거 (예: "발주→입고").
 */
export const MANUAL_CHAINS: Array<{ from: string; to: string; why: string }> = [];
