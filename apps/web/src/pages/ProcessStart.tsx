import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toSafeHtml } from '../lib/richText';
import { BpmnMiniView } from '../components/BpmnMiniView';

interface ProcessTaskTemplateDto {
  id?: string;
  name: string;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  stageLabel?: string;
  description?: string;
  assigneeHint?: string;
}
interface ProcessTemplateDto {
  id?: string;
  title: string;
  description?: string;
  type: 'RECURRING' | 'PROJECT';
  bpmnJson?: any;
  tasks: ProcessTaskTemplateDto[];
  createdAt?: string;
  owner?: { id: string; name: string; orgUnit?: { id: string; name: string } };
}

export function ProcessStart() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialTemplateId = params?.get('templateId') || '';
  const returnToParam = params?.get('return') || '';

  const [templates, setTemplates] = useState<ProcessTemplateDto[]>([]);
  const [tplId, setTplId] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  // AI 검색 관련 상태
  const [aiQuery, setAiQuery] = useState('');
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResults, setAiResults] = useState<Array<{ template: ProcessTemplateDto; score: number; reason: string }>>([]);
  const [showAiSearch, setShowAiSearch] = useState(true);

  const [startTitle, setStartTitle] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [moldCode, setMoldCode] = useState('');
  const [carModelCode, setCarModelCode] = useState('');

  const [itemsMaster, setItemsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [moldsMaster, setMoldsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [carModelsMaster, setCarModelsMaster] = useState<Array<{ code: string; name: string }>>([]);

  const [selectedFull, setSelectedFull] = useState<ProcessTemplateDto | null>(null);
  const selected = useMemo(() => selectedFull || templates.find(t => t.id === tplId) || null, [templates, tplId, selectedFull]);
  // derive BPMN task count for mismatch hint
  const bpmnTaskCount = useMemo(() => {
    try {
      let j: any = (selectedFull as any)?.bpmnJson;
      if (typeof j === 'string') j = JSON.parse(j);
      const nodes = Array.isArray(j?.nodes) ? j.nodes : [];
      return nodes.filter((n: any) => String(n?.type || '').toLowerCase() === 'task').length;
    } catch { return 0; }
  }, [selectedFull]);
  const mismatch = !!(selectedFull && bpmnTaskCount > (selectedFull.tasks?.length || 0));
  const [cloneTitle, setCloneTitle] = useState('');
  useEffect(() => {
    if (selectedFull?.title) setCloneTitle(`${selectedFull.title} (사본)`);
  }, [selectedFull?.id]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [assignees, setAssignees] = useState<Record<string, string[]>>({});
  const [plans, setPlans] = useState<Record<string, { plannedStartAt?: string; plannedEndAt?: string; deadlineAt?: string }>>({});
  const [initiativeId, setInitiativeId] = useState('');
  const [myInits, setMyInits] = useState<Array<{ id: string; title: string }>>([]);
  const [itemManual, setItemManual] = useState(false);
  const [moldManual, setMoldManual] = useState(false);
  const [carModelManual, setCarModelManual] = useState(false);

  // Fallback preview from BPMN if compiled tasks are not present
  const taskPreview: Array<any> = useMemo(() => {
    if (selected?.tasks && selected.tasks.length) return selected.tasks.map((t: any) => ({ ...t, __source: 'compiled' }));
    let bpmn: any = (selectedFull as any)?.bpmnJson;
    try {
      if (typeof bpmn === 'string' && bpmn.trim().startsWith('{')) bpmn = JSON.parse(bpmn);
    } catch {}
    const nodes = bpmn?.nodes;
    if (Array.isArray(nodes)) {
      return nodes
        .filter((n: any) => String(n?.type || '') === 'task')
        .map((n: any) => ({
          id: String(n.id),
          name: n.name || '',
          taskType: n.taskType || 'TASK',
          stageLabel: n.stageLabel || '',
          description: n.description || '',
          assigneeHint: n.assigneeHint || '',
          __source: 'bpmn',
        }));
    }

    return [];
  }, [selected, selectedFull]);

  // AI 기반 프로세스 검색
  async function searchWithAI() {
    if (!aiQuery.trim()) return;
    setAiSearching(true);
    setAiResults([]);
    try {
      // 간단한 키워드 매칭 + 유사도 기반 검색
      const query = aiQuery.toLowerCase();
      const keywords = query.split(/\s+/).filter(Boolean);
      
      const scored = templates.map(t => {
        let score = 0;
        const reasons: string[] = [];
        const title = (t.title || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        
        // 제목 매칭
        for (const kw of keywords) {
          if (title.includes(kw)) {
            score += 30;
            reasons.push(`제목에 "${kw}" 포함`);
          }
          if (desc.includes(kw)) {
            score += 20;
            reasons.push(`설명에 "${kw}" 포함`);
          }
        }
        
        // 과제 이름 매칭
        const tasks = t.tasks || [];
        for (const task of tasks) {
          const taskName = (task.name || '').toLowerCase();
          const taskDesc = (task.description || '').toLowerCase();
          for (const kw of keywords) {
            if (taskName.includes(kw)) {
              score += 15;
              reasons.push(`과제 "${task.name}"에 "${kw}" 포함`);
            }
            if (taskDesc.includes(kw)) {
              score += 10;
            }
          }
        }
        
        // 특정 키워드 패턴 매칭
        const patterns: Array<{ keywords: string[]; boost: number; label: string }> = [
          { keywords: ['이관', '양산', '이전'], boost: 25, label: '이관/양산 관련' },
          { keywords: ['금형', '몰드', 'mold'], boost: 25, label: '금형 관련' },
          { keywords: ['품질', '검사', '불량'], boost: 25, label: '품질 관련' },
          { keywords: ['결재', '승인', '검토'], boost: 20, label: '결재 프로세스' },
          { keywords: ['신규', '개발', '설계'], boost: 20, label: '신규 개발' },
          { keywords: ['변경', '수정', 'ecn', 'eco'], boost: 20, label: '변경 관리' },
          { keywords: ['출하', '납품', '배송'], boost: 20, label: '출하/납품' },
          { keywords: ['입고', '자재', '구매'], boost: 20, label: '자재/구매' },
        ];
        
        for (const p of patterns) {
          const matched = p.keywords.some(pk => query.includes(pk) && (title.includes(pk) || desc.includes(pk)));
          if (matched) {
            score += p.boost;
            reasons.push(p.label);
          }
        }
        
        return { template: t, score, reason: [...new Set(reasons)].slice(0, 3).join(', ') || '일반 매칭' };
      });
      
      const filtered = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      setAiResults(filtered);
      
      if (!filtered.length) {
        // 검색 결과가 없으면 모든 템플릿 표시
        setAiResults(templates.slice(0, 5).map(t => ({ template: t, score: 0, reason: '전체 템플릿' })));
      }
    } catch (e: any) {
      console.error('AI search error:', e);
    } finally {
      setAiSearching(false);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiJson<ProcessTemplateDto[]>(`/api/process-templates`);
        setTemplates(res || []);
        if (initialTemplateId) setTplId(initialTemplateId);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load full template detail when a template is selected to ensure tasks (with IDs) are present
  useEffect(() => {
    (async () => {
      if (!tplId) { setSelectedFull(null); return; }
      try {
        const one = await apiJson<ProcessTemplateDto>(`/api/process-templates/${encodeURIComponent(tplId)}`);
        setSelectedFull(one || null);
      } catch {
        setSelectedFull(null);
      }
    })();
  }, [tplId]);

  useEffect(() => {
    (async () => {
      try {
        const im = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/items`);
        setItemsMaster(im?.items || []);
      } catch {}
      try {
        const mm = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/molds`);
        setMoldsMaster(mm?.items || []);
      } catch {}
      try {
        const cm = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/car-models`);
        setCarModelsMaster(cm?.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ul = await apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/users`);
        setUsers(ul?.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const res = await apiJson<{ items: Array<{ id: string; title: string }> }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`);
        setMyInits(res?.items || []);
      } catch {}
    })();
  }, [userId]);

  async function start() {
    if (!userId) { alert('로그인이 필요합니다.'); return; }
    if (!tplId) { alert('템플릿을 선택하세요.'); return; }
    if (!startTitle.trim()) { alert('세부 제목을 입력하세요.'); return; }
    const finalTitle = selected ? `${selected.title} - ${startTitle}` : startTitle;
    const taskAssignees = Object.entries(assignees)
      .flatMap(([k, arr]) => (arr || []).filter(Boolean).map((v) => ({ taskTemplateId: k, assigneeId: v })));
    const taskPlans = Object.entries(plans)
      .map(([k, v]) => ({
        taskTemplateId: k,
        plannedStartAt: v.plannedStartAt || undefined,
        plannedEndAt: v.plannedEndAt || undefined,
        deadlineAt: v.deadlineAt || undefined,
      }))
      .filter((x) => x.plannedStartAt || x.plannedEndAt || x.deadlineAt);
    const body = {
      templateId: tplId,
      title: finalTitle,
      startedById: userId,
      itemCode: itemCode || undefined,
      moldCode: moldCode || undefined,
      carModelCode: carModelCode || undefined,
      taskAssignees,
      taskPlans,
      initiativeId: initiativeId || undefined,
    };
    try {
      setStarting(true);
      const inst = await apiJson<any>(`/api/processes`, { method: 'POST', body: JSON.stringify(body) });
      if (inst?.id) {
        alert('프로세스가 시작되었습니다. 목록으로 돌아갑니다.');
        const r = String(returnToParam || '').trim();
        if (r && r.startsWith('/')) nav(r);
        else nav('/process/instances');
      }
    } catch (e: any) {
      alert(e?.message || '프로세스 시작 중 오류가 발생했습니다.');
    } finally {
      setStarting(false);
    }
  }

  async function cloneTemplateForStart() {
    if (!userId) { alert('로그인이 필요합니다.'); return; }
    if (!selectedFull?.id) { alert('템플릿을 선택하세요.'); return; }
    const title = (cloneTitle || '').trim();
    if (!title) { alert('새 템플릿 제목을 입력하세요.'); return; }
    let bpmn: any = (selectedFull as any)?.bpmnJson;
    try { if (typeof bpmn === 'string' && bpmn.trim().startsWith('{')) bpmn = JSON.parse(bpmn); } catch {}
    try {
      const body: any = {
        title,
        description: selectedFull.description || '',
        type: (selectedFull.type as any) || 'PROJECT',
        ownerId: userId,
        visibility: 'PUBLIC',
        bpmnJson: bpmn,
      };
      const created = await apiJson<ProcessTemplateDto>(`/api/process-templates`, { method: 'POST', body: JSON.stringify(body) });
      if (created?.id) {
        setTemplates((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);
        setTplId(created.id);
        setSelectedFull(created);
        setCloneTitle(`${created.title} (사본)`);
        alert('사본 템플릿이 생성되었습니다. 이 템플릿으로 시작 정보를 입력하세요.');
      }
    } catch (e: any) {
      alert(e?.message || '사본 템플릿 생성 중 오류가 발생했습니다.');
    }
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>새 프로세스 시작</h2>
      {loading && <div>불러오는 중...</div>}

      {/* AI 프로세스 검색 */}
      {showAiSearch && (
        <div style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)', border: '2px solid #16a34a', borderRadius: 12, padding: 16, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#15803d' }}>AI 프로세스 찾기</div>
            <button
              type="button"
              onClick={() => setShowAiSearch(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280' }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 13, color: '#166534', marginBottom: 12 }}>
            어떤 업무를 처리하고 싶으신가요? 자연어로 설명해주시면 적합한 프로세스를 추천해드립니다.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchWithAI()}
              placeholder="예: 금형 이관 작업을 진행하고 싶어요, 품질 검사 프로세스가 필요해요..."
              style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #86efac', fontSize: 14 }}
            />
            <button
              type="button"
              onClick={searchWithAI}
              disabled={aiSearching || !aiQuery.trim()}
              style={{
                background: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontWeight: 600,
                cursor: aiSearching || !aiQuery.trim() ? 'not-allowed' : 'pointer',
                opacity: aiSearching || !aiQuery.trim() ? 0.6 : 1,
              }}
            >
              {aiSearching ? '검색 중...' : '🔍 검색'}
            </button>
          </div>
          {aiResults.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#15803d', marginBottom: 8 }}>
                추천 프로세스 ({aiResults.length}개)
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {aiResults.map((r, idx) => (
                  <div
                    key={r.template.id || idx}
                    onClick={() => {
                      setTplId(r.template.id || '');
                      setShowAiSearch(false);
                    }}
                    style={{
                      background: '#fff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#16a34a')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#bbf7d0')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 600, color: '#166534' }}>{r.template.title}</div>
                      {r.score > 0 && (
                        <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 4 }}>
                          매칭도 {Math.min(100, r.score)}%
                        </span>
                      )}
                    </div>
                    {r.reason && (
                      <div style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>💡 {r.reason}</div>
                    )}
                    {r.template.description && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.template.description.replace(/<[^>]*>/g, '').substring(0, 80)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            💡 팁: "이관", "금형", "품질", "결재", "변경" 등의 키워드를 포함하면 더 정확한 결과를 얻을 수 있습니다.
          </div>
        </div>
      )}

      {!showAiSearch && (
        <button
          type="button"
          onClick={() => setShowAiSearch(true)}
          style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#16a34a', cursor: 'pointer', width: 'fit-content' }}
        >
          🤖 AI로 프로세스 찾기
        </button>
      )}

      <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>템플릿 선택</label>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)}>
            <option value="">선택</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.title}{t.owner?.name ? ` (${t.owner.name})` : ''}</option>
            ))}
          </select>
          {!templates.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>사용 가능한 템플릿이 없습니다.</div>}
        </div>
        <div>
          {selected ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{selected.title}</div>
                {(selected as any).owner?.name && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    📝 작성자: {(selected as any).owner.name}{(selected as any).owner.orgUnit?.name ? ` · ${(selected as any).owner.orgUnit.name}` : ''}{(selected as any).createdAt ? ` · ${new Date((selected as any).createdAt).toLocaleDateString()}` : ''}
                  </div>
                )}
                {!!selected.description && (
                  <div
                    className="rich-content"
                    style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}
                    dangerouslySetInnerHTML={{ __html: toSafeHtml(selected.description) }}
                  />
                )}
              </div>
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  세부 제목
                  <input value={startTitle} onChange={(e) => setStartTitle(e.target.value)} placeholder="예: 2025-01-10 M123 2라인 이관" />
                </label>
                <label>
                  품번(Item Code)
                  {!itemManual ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <select value={itemCode} onChange={(e) => setItemCode(e.target.value)}>
                        <option value="">선택</option>
                        {itemsMaster.map(it => (
                          <option key={it.code} value={it.code}>{it.code} · {it.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn" onClick={() => setItemManual(true)}>직접 입력</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="예: ITEM-001" />
                      <button type="button" className="btn" onClick={() => setItemManual(false)}>목록에서 선택</button>
                    </div>
                  )}
                </label>
              </div>
              {(() => { let j: any = (selectedFull as any)?.bpmnJson; try { if (typeof j === 'string') j = JSON.parse(j); } catch {} return j && Array.isArray(j.nodes) && Array.isArray(j.edges) ? j : null; })() && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>흐름 미리보기</div>
                  <BpmnMiniView bpmn={(() => { let j: any = (selectedFull as any)?.bpmnJson; try { if (typeof j === 'string') j = JSON.parse(j); } catch {} return j; })()} height={260} />
                </div>
              )}
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  금형 번호(Mold)
                  {!moldManual ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <select value={moldCode} onChange={(e) => setMoldCode(e.target.value)}>
                        <option value="">선택</option>
                        {moldsMaster.map(m => (
                          <option key={m.code} value={m.code}>{m.code} · {m.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn" onClick={() => setMoldManual(true)}>직접 입력</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <input value={moldCode} onChange={(e) => setMoldCode(e.target.value)} placeholder="예: M123" />
                      <button type="button" className="btn" onClick={() => setMoldManual(false)}>목록에서 선택</button>
                    </div>
                  )}
                </label>
                <label>
                  차종(Car Model)
                  {!carModelManual ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <select value={carModelCode} onChange={(e) => setCarModelCode(e.target.value)}>
                        <option value="">선택</option>
                        {carModelsMaster.map(c => (
                          <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn" onClick={() => setCarModelManual(true)}>직접 입력</button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <input value={carModelCode} onChange={(e) => setCarModelCode(e.target.value)} placeholder="예: SONATA" />
                      <button type="button" className="btn" onClick={() => setCarModelManual(false)}>목록에서 선택</button>
                    </div>
                  )}
                </label>
              </div>
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  연결할 과제(Initiative)
                  <select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                    <option value="">직접 입력</option>
                    {myInits.map(it => (
                      <option key={it.id} value={it.id}>{it.title}</option>
                    ))}
                  </select>
                  {!initiativeId && (
                    <input value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} placeholder="Initiative ID 직접 입력" />
                  )}
                </label>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>과제 미리보기</div>
                  {taskPreview.length > 0 && taskPreview[0]?.__source === 'bpmn' && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>템플릿을 저장하면 담당자/일정 입력이 활성화됩니다.</div>
                  )}
                  {selectedFull && selectedFull.tasks && bpmnTaskCount > (selectedFull.tasks?.length || 0) && (
                    <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fbbf24', padding: '2px 6px', borderRadius: 6 }}>
                      템플릿 과제(DB) 수({selectedFull.tasks.length})가 BPMN Task 수({bpmnTaskCount})보다 적습니다. 구조 변경은 복제된 새 템플릿으로 시작해야 반영됩니다.
                    </div>
                  )}
                </div>
                {mismatch && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, marginBottom: 8, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 13, color: '#334155' }}>복제 후 시작</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <label>
                        새 템플릿 제목
                        <input value={cloneTitle} onChange={(e) => setCloneTitle(e.target.value)} placeholder={`${selectedFull?.title || ''} (사본)`} />
                      </label>
                      <div>
                        <button type="button" className="btn" onClick={cloneTemplateForStart}>사본 템플릿 생성</button>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gap: 6 }}>
                  {taskPreview.map((t: any, idx: number) => (
                    <div key={t.id || idx} style={{ border: '1px solid #eef2f7', borderRadius: 6, padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{t.name}{t.stageLabel ? ` · ${t.stageLabel}` : ''}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{t.taskType}</div>
                      {!!t.assigneeHint && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>담당자 힌트: {t.assigneeHint}</div>
                      )}
                      {!!t.description && (
                        <div
                          className="rich-content"
                          style={{ fontSize: 12, color: '#334155', marginTop: 6 }}
                          dangerouslySetInnerHTML={{ __html: toSafeHtml(String(t.description)) }}
                        />
                      )}
                      <div style={{ marginTop: 6 }}>
                        <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>담당자(복수 선택 가능)</label>
                        <select
                          multiple
                          value={(t.id && assignees[String(t.id)]) || []}
                          onChange={(e) => {
                            if (!t.id) return;
                            const opts = Array.from((e.target as HTMLSelectElement).selectedOptions).map(o => o.value);
                            setAssignees((prev) => ({ ...prev, [String(t.id)]: opts }));
                          }}
                          disabled={t.__source === 'bpmn'}
                          style={{ minHeight: 64 }}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
                        <label>
                          <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>시작</span>
                          <input type="datetime-local"
                            value={(t.id && plans[String(t.id)]?.plannedStartAt) || ''}
                            onChange={(e) => t.id && setPlans((prev) => ({ ...prev, [String(t.id)]: { ...prev[String(t.id)], plannedStartAt: e.target.value } }))}
                            disabled={t.__source === 'bpmn'}
                          />
                        </label>
                        <label>
                          <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>종료</span>
                          <input type="datetime-local"
                            value={(t.id && plans[String(t.id)]?.plannedEndAt) || ''}
                            onChange={(e) => t.id && setPlans((prev) => ({ ...prev, [String(t.id)]: { ...prev[String(t.id)], plannedEndAt: e.target.value } }))}
                            disabled={t.__source === 'bpmn'}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  {!taskPreview.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={start} disabled={starting}>
                  {starting ? '시작 중...' : '시작'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>왼쪽에서 템플릿을 선택하면 세부 정보를 입력할 수 있습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
