import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import {
  ApprovalEntry,
  LintFinding,
  approvalEntryLabel,
  fixAddStartEnd,
  fixApprovalEntries,
  fixAssigneeOrg,
  parseApprovalEntries,
  fixConnectToEnd,
  fixEdgeCondition,
  fixRejectLoopback,
  fixRejectToEnd,
  fixRemoveEdge,
} from '../lib/bpmnLint';

/**
 * BPMN 완성도 점검 패널 — 린터가 찾은 빨간칸을 객관식/원클릭으로 닫는다.
 * 보기(값)는 제한된 풀(조직 목록, 구성원 검색, 열거된 경로)에서만 고르고,
 * 선택하면 bpmnJson이 즉시 패치되어 그래프에 반영된다.
 */
export function BpmnChecklist({ jsonText, onChangeJson, findings, dismissed, onDismiss }: {
  jsonText: string;
  onChangeJson: (t: string) => void;
  findings: LintFinding[];
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
}) {
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [userQuery, setUserQuery] = useState('');
  const [userOptions, setUserOptions] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);

  useEffect(() => {
    apiJson<{ items: Array<{ id: string; name: string }> }>('/api/orgs')
      .then((r) => setOrgs(r.items || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/orgs/members/all${userQuery.trim() ? `?q=${encodeURIComponent(userQuery.trim())}` : ''}`)
        .then((r) => setUserOptions(r.items || []))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [userQuery]);

  const json = useMemo(() => {
    try { return JSON.parse(jsonText || '{}'); } catch { return null; }
  }, [jsonText]);

  const apply = (next: any) => onChangeJson(JSON.stringify(next, null, 2));
  const nodeById = (id?: string) => (json?.nodes || []).find((n: any) => String(n.id) === String(id));
  const nodeName = (id?: string) => {
    const n = nodeById(id);
    const t = String(n?.type || '');
    return String(n?.name || '').trim() || (t === 'start' ? '시작' : t === 'end' ? '종료' : String(id || ''));
  };
  const userName = (uid: string) => {
    const u = userOptions.find((x) => x.id === uid);
    return u ? `${u.name}${u.orgName ? ` (${u.orgName})` : ''}` : uid;
  };

  const visible = findings.filter((f) => !dismissed.has(f.id));
  const errors = visible.filter((f) => f.severity === 'error');
  const warns = visible.filter((f) => f.severity === 'warn');

  if (!json) return null;
  if (!visible.length) {
    return (
      <div style={{ border: '1px solid #86efac', background: '#f0fdf4', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#15803d' }}>
        ✓ 완성도 점검 통과 — 템플릿을 완성할 수 있습니다.
      </div>
    );
  }

  const btnSm: React.CSSProperties = { padding: '3px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' };
  const btnPrimary: React.CSSProperties = { ...btnSm, background: '#0F3D73', color: '#fff', border: 'none' };

  function renderFix(f: LintFinding) {
    switch (f.code) {
      case 'ASSIGNEE_MISSING':
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) apply(fixAssigneeOrg(json, f.nodeId!, e.target.value)); }}
              style={{ fontSize: 12, maxWidth: 220 }}
            >
              <option value="">담당 조직 선택...</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button type="button" style={btnSm} onClick={() => onDismiss(f.id)}>시작 시 수동 배정 (그대로 두기)</button>
          </div>
        );
      case 'APPROVAL_LINE_MISSING': {
        // 사람 + 역할(팀장/임원) 혼합 결재선. 역할은 프로세스 시작 시 사람으로 확정된다.
        const entries = parseApprovalEntries(nodeById(f.nodeId));
        const orgNameOf = (oid: string) => orgs.find((o) => o.id === oid)?.name || '(조직)';
        const setEntries = (next: ApprovalEntry[]) => apply(fixApprovalEntries(json, f.nodeId!, next));
        return (
          <div style={{ display: 'grid', gap: 6 }}>
            {entries.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {entries.map((en, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: en.kind === 'USER' ? '#fffbeb' : '#f5f3ff', border: `1px solid ${en.kind === 'USER' ? '#fcd34d' : '#ddd6fe'}`, borderRadius: 999, padding: '2px 8px' }}>
                    <b style={{ color: en.kind === 'USER' ? '#b45309' : '#7c3aed' }}>{i + 1}</b> {approvalEntryLabel(en, orgNameOf, userName)}
                    <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b45309', padding: 0 }}
                      onClick={() => setEntries(entries.filter((_, x) => x !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={btnPrimary} onClick={() => setEntries([...entries, { kind: 'MGR', orgUnitId: 'STARTER' }])}>+ 시작자 팀 팀장</button>
              <select value="" onChange={(e) => { if (e.target.value) setEntries([...entries, { kind: 'MGR', orgUnitId: e.target.value }]); }} style={{ fontSize: 12, maxWidth: 160 }}>
                <option value="">+ 특정 팀 팀장...</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} 팀장</option>)}
              </select>
              <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="이름 검색" style={{ fontSize: 12, width: 100 }} />
              <select
                value=""
                onChange={(e) => { const v = e.target.value; if (v) setEntries([...entries, { kind: 'USER', userId: v }]); }}
                style={{ fontSize: 12, maxWidth: 200 }}
              >
                <option value="">+ 결재자(사람)...</option>
                {userOptions.filter((u) => !entries.some((en) => en.kind === 'USER' && en.userId === u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` (${u.orgName})` : ''}</option>
                ))}
              </select>
            </div>
          </div>
        );
      }
      case 'APPROVAL_NO_REJECT_PATH':
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary} onClick={() => apply(fixRejectLoopback(json, f.nodeId!))}>반려 시 이전 단계로 되돌림 (추천)</button>
            <button type="button" style={btnSm} onClick={() => apply(fixRejectToEnd(json, f.nodeId!))}>반려 시 프로세스 종료</button>
            <button type="button" style={btnSm} onClick={() => onDismiss(f.id)}>반려 없음 · 무시</button>
          </div>
        );
      case 'XOR_NO_CONDITION': {
        const outs = (json.edges || []).filter((e: any) => String(e.source) === String(f.nodeId) && !e.isLoopBack && !String(e.condition || '').trim());
        return (
          <div style={{ display: 'grid', gap: 6 }}>
            {outs.map((e: any) => (
              <div key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: '#475569' }}>→ {nodeName(e.target)}:</span>
                <button type="button" style={btnSm} onClick={() => apply(fixEdgeCondition(json, e.id, "last.approval.status == 'APPROVED'"))}>✔ 승인이면</button>
                <button type="button" style={btnSm} onClick={() => apply(fixEdgeCondition(json, e.id, "last.approval.status == 'REJECTED'"))}>✖ 반려면</button>
                <input placeholder="직접 입력 후 Enter (예: itemCode == 'A')" style={{ fontSize: 12, flex: 1, minWidth: 180 }}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') { const v = (ev.target as HTMLInputElement).value.trim(); if (v) apply(fixEdgeCondition(json, e.id, v)); } }} />
              </div>
            ))}
            {f.severity === 'warn' && <button type="button" style={{ ...btnSm, justifySelf: 'start' }} onClick={() => onDismiss(f.id)}>기본 경로로 두기 · 무시</button>}
          </div>
        );
      }
      case 'NODE_DEAD_END':
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={btnPrimary} onClick={() => apply(fixConnectToEnd(json, f.nodeId!))}>종료(end)에 연결</button>
            <button type="button" style={btnSm} onClick={() => onDismiss(f.id)}>무시 (그래프에서 직접 연결)</button>
          </div>
        );
      case 'NO_START':
        return <button type="button" style={btnPrimary} onClick={() => apply(fixAddStartEnd(json, 'start'))}>시작 노드 추가·연결</button>;
      case 'NO_END':
        return <button type="button" style={btnPrimary} onClick={() => apply(fixAddStartEnd(json, 'end'))}>종료 노드 추가·연결</button>;
      case 'EDGE_BROKEN':
        return <button type="button" style={btnPrimary} onClick={() => apply(fixRemoveEdge(json, f.edgeId!))}>이 연결 삭제</button>;
      case 'XOR_SINGLE_PATH':
      case 'UNREACHABLE':
      case 'NO_PATH_TO_END':
        return <button type="button" style={btnSm} onClick={() => onDismiss(f.id)}>확인 · 무시</button>;
      default:
        return null;
    }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>완성도 점검</b>
        {errors.length > 0 && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 700 }}>● 해결 필요 {errors.length}</span>}
        {warns.length > 0 && <span style={{ fontSize: 12, color: '#d97706', fontWeight: 700 }}>● 확인 권장 {warns.length}</span>}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>빨간 항목을 모두 해결해야 템플릿을 완성할 수 있습니다. 선택하면 그래프에 바로 반영됩니다.</span>
      </div>
      <div style={{ display: 'grid', gap: 8, padding: 10 }}>
        {[...errors, ...warns].map((f) => (
          <div key={f.id} style={{
            borderLeft: `3px solid ${f.severity === 'error' ? '#dc2626' : '#f59e0b'}`,
            background: f.severity === 'error' ? '#fef2f2' : '#fffbeb',
            borderRadius: 6, padding: '8px 10px', display: 'grid', gap: 6,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: f.severity === 'error' ? '#991b1b' : '#92400e' }}>{f.message}</div>
            {renderFix(f)}
          </div>
        ))}
      </div>
    </div>
  );
}
