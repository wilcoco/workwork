import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

export function OkrInput() {
  const [userId, setUserId] = useState('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [parentKrs, setParentKrs] = useState<any[]>([]);
  const [parentKrId, setParentKrId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [myObjectives, setMyObjectives] = useState<any[]>([]);
  const [showExample, setShowExample] = useState(false);

  function roleLabel(r?: string) {
    if (r === 'CEO') return '대표';
    if (r === 'EXEC') return '임원';
    if (r === 'MANAGER') return '팀장';
    if (r === 'INDIVIDUAL') return '팀원';
    return r || '';
  }

  const [oTitle, setOTitle] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oMonths, setOMonths] = useState<boolean[]>(() => Array(12).fill(false));

  const months2026 = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1)), []);
  function toggleOMonth(i: number) { setOMonths(prev => prev.map((v, idx) => idx === i ? !v : v)); }

  type Row = { title: string; metric: string; target: string; unit: string; direction: 'AT_LEAST' | 'AT_MOST'; months: boolean[] };
  const [rows, setRows] = useState<Row[]>([{ title: '', metric: '', target: '', unit: '', direction: 'AT_LEAST', months: Array(12).fill(false) }] );
  function addRow() { setRows(prev => [...prev, { title: '', metric: '', target: '', unit: '', direction: 'AT_LEAST', months: Array(12).fill(false) }]); }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }
  function toggleRMonth(r: number, m: number) {
    setRows(prev => prev.map((row, i) => i === r ? { ...row, months: row.months.map((v, j) => j === m ? !v : v) } : row));
  }

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        async function getOrDefault<T>(path: string, def: T): Promise<T> {
          try {
            return await apiJson<T>(path);
          } catch (e: any) {
            const msg = String(e?.message || '');
            const status = Number(e?.status || 0);
            if (status === 404 || msg.startsWith('Non-JSON response')) return def as T;
            throw e;
          }
        }
        const me = await getOrDefault<{ id: string; role: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`, { id: '', role: '' } as any);
        setMyRole(((me as any).role as any) || '');
        const p = await getOrDefault<{ items: any[] }>(`/api/okrs/parent-krs?userId=${encodeURIComponent(userId)}`, { items: [] });
        setParentKrs(p.items || []);
        const mine = await getOrDefault<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`, { items: [] });
        setMyObjectives(mine.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  async function save() {
    try {
      setError(null);
      setSuccess(null);
      setSaving(true);
      if (!userId) throw new Error('userId');
      if (!oTitle) throw new Error('Objective 제목');
      const selO = oMonths.map((v, i) => v ? i : -1).filter(i => i >= 0);
      if (!selO.length) throw new Error('Objective 기간');
      if (myRole !== 'CEO' && !parentKrId) throw new Error('상위 O-KR');
      const validRows = rows.filter(r => r.title && r.metric && r.target !== '' && r.unit);
      if (!validRows.length) throw new Error('KR 최소 1개');

      const mStart = Math.min(...selO);
      const mEnd = Math.max(...selO);
      const s = new Date(2026, mStart, 1);
      const e = new Date(2026, mEnd + 1, 0);
      const periodStart = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
      const periodEnd = `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}`;

      const obj = await apiJson<{ id: string }>(`/api/okrs/objectives`, {
        method: 'POST',
        body: JSON.stringify({ userId, title: oTitle, description: oDesc || undefined, periodStart, periodEnd, alignsToKrId: myRole === 'CEO' ? undefined : parentKrId }),
      });

      for (const r of validRows) {
        const kr = await apiJson<{ id: string }>(`/api/okrs/objectives/${encodeURIComponent(obj.id)}/krs`, {
          method: 'POST',
          body: JSON.stringify({ userId, title: r.title, metric: r.metric, target: Number(r.target), unit: r.unit, direction: r.direction }),
        });
        const sel = r.months.map((v, i) => v ? i : -1).filter(i => i >= 0);
        if (sel.length) {
          const ms = Math.min(...sel);
          const me = Math.max(...sel);
          const ss = new Date(2026, ms, 1);
          const ee = new Date(2026, me + 1, 0);
          const startAt = `${ss.getFullYear()}-${String(ss.getMonth()+1).padStart(2,'0')}-${String(ss.getDate()).padStart(2,'0')}`;
          const endAt = `${ee.getFullYear()}-${String(ee.getMonth()+1).padStart(2,'0')}-${String(ee.getDate()).padStart(2,'0')}`;
          await apiJson(`/api/initiatives`, {
            method: 'POST',
            body: JSON.stringify({ keyResultId: kr.id, ownerId: userId, title: r.title, startAt, endAt }),
          });
        }
      }

      setOTitle(''); setODesc(''); setOMonths(Array(12).fill(false)); setRows([{ title: '', metric: '', target: '', unit: '', direction: 'AT_LEAST', months: Array(12).fill(false) }]); setParentKrId('');
      const mine = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(userId)}`);
      setMyObjectives(mine.items || []);
      setSuccess('OKR이 저장되었습니다');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, maxWidth: 960, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!userId || loading} onClick={() => window.location.reload()} className="btn btn-primary">새로고침</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>OKR 작성 안내</div>
          <div style={{ display: 'grid', gap: 6, color: '#334155' }}>
            <div>
              <b>취지</b>: 회사 목표에 정렬된 결과(Outcome)에 집중하고, 측정 가능한 지표로 성과를 관리합니다. 분기·월 단위로 주기적으로 점검합니다.
            </div>
            <div>
              <b>OKR을 쓰는 이유</b>:
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                <li>정렬과 집중: 상향·하향 정렬로 모두가 같은 방향으로 일합니다.</li>
                <li>결과 중심 학습: 결과(KR)로 주기적 리뷰를 돌며 개선합니다.</li>
                <li>투명성과 책임: 목표·지표·진척이 명확해 자율·책임이 강화됩니다.</li>
              </ul>
            </div>
            <div>
              <b>OKR vs KPI</b>:
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                <li>OKR: 변화·개선 목표(전략적). 스토리 있는 Objective + 정량 KR, 분기/월 리뷰.</li>
                <li>KPI: 일상 운영지표(상시 모니터링). 현상 유지 관리와 경보 성격.</li>
                <li>운영: OKR은 변화를 만들고, KPI는 상태를 지킵니다. 둘 다 필요합니다.</li>
              </ul>
            </div>
            <div>
              <b>역할별 작성</b>:
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                <li>대표/임원: 회사·실 단위 <b>Objective</b>를 정의하고, 방향성과 기준이 명확한 <b>KR</b>을 설정</li>
                <li>팀장: 상위 KR 1개를 선택해 팀 <b>Objective</b>를 작성하고 팀 <b>KR</b>로 전개</li>
                <li>팀원: 상위 KR 1개를 선택해 개인 <b>Objective</b>를 작성하고, 과제(이니셔티브) 월별 계획으로 연결</li>
              </ul>
            </div>
            <div>
              <b>상위에서 분기</b>: 상단의 <b>역할 선택</b> 후 <b>상위 O-KR 선택</b>에서 <u>부모 KR 1개만</u> 지정하고, 자신의 Objective/KR을 작성합니다.
            </div>
            <div>
              <b>좋은 KR 팁</b>: 방향(<code>이상</code>/<code>이하</code>)을 명확히, <code>metric</code>/<code>unit</code>/<code>target</code> 필수, 월 단위로 최신 기록 유지.
            </div>
            <div>
              <b>입력 순서</b>: 역할 선택 → 상위 O-KR 선택 → Objective 제목/설명·기간 → KR 제목/지표/목표/단위/방향 → (필요시) 과제 기간 → 저장
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowExample(v => !v)}>{showExample ? '예시 닫기' : '예시 보기'}</button>
              </div>
              {showExample && (
                <div>
                  <b>제조 예시(범퍼 사출·도장·조립, 단일 부모 KR 정렬)</b>:
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    <li>
                      <b>대표(CEO)</b> — Objective: 납기 준수와 품질 안정화로 수익성 개선<br/>
                      KR-CEO-A: 전체 공정 불량률 0.6% 이하 / KR-CEO-B: 납기 준수율 98% 이상
                    </li>
                    <li>
                      <b>생산실장</b> — 상위 KR 수신: [대표 · KR-CEO-A]<br/>
                      Objective: 공정 품질 변동을 낮춰 회사 불량률 목표 달성<br/>
                      주요 KR: 도장 불량률 0.5% 이하, 사출 불량률 0.7% 이하
                    </li>
                    <li>
                      <b>생산팀장</b> — 상위 KR 수신: [생산실장 · 도장 불량률 0.5% 이하]<br/>
                      Objective: 도장 품질 변동 절반으로 축소해 실 목표에 기여<br/>
                      주요 KR: 도장 불량률 0.8%→0.4% 이하, 색상 교체 TAT 12→8분, 라인 OEE 70%→78% 이상
                    </li>
                    <li>
                      <b>도장담당</b> — 상위 KR 수신: [생산팀장 · 도장 불량률 0.8%→0.4% 이하]<br/>
                      Objective: 공정 조건 표준화로 불량·전환시간을 줄인다<br/>
                      주요 KR: 반별 불량률 0.6% 이하, 교체 TAT 10→7분, 표준작업 준수율 95% 이상
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>상위 선택</h3>
        <div style={card}>
          <div className="stack-1-2">
            <select value={myRole} disabled style={{ ...input, appearance: 'auto' as any, opacity: 0.85 }}>
              <option value="">역할 선택</option>
              <option value="CEO">대표</option>
              <option value="EXEC">임원</option>
              <option value="MANAGER">팀장</option>
              <option value="INDIVIDUAL">팀원</option>
            </select>
            {myRole !== 'CEO' && (
              <select value={parentKrId} onChange={(e) => setParentKrId(e.target.value)} style={{ ...input, appearance: 'auto' as any }}>
                <option value="">상위 O-KR 선택</option>
                {parentKrs.map((kr) => (
                  <option key={kr.id} value={kr.id}>[{`${roleLabel(kr.objective?.owner?.role)}-${kr.objective?.owner?.name || ''}`}] {kr.objective?.title} / KR: {kr.title}</option>
                ))}
              </select>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            역할/조직 변경은 관리자(대표)가 구성원 관리에서 설정합니다.
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>개선목표(O)</h3>
        <div style={card}>
          <input value={oTitle} onChange={(e) => setOTitle(e.target.value)} placeholder="Objective 제목" style={input} />
          <textarea value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="Objective 내용" style={{ ...input, minHeight: 80 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 1fr) repeat(12, minmax(18px, 1fr))', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>기간(2026)</div>
            {months2026.map((_, i) => (
              <div key={`ol-${i}`} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{i + 1}</div>
            ))}
            <div style={{ gridColumn: '1 / span 1' }} />
            {oMonths.map((on, i) => (
              <div
                key={`om-${i}`}
                onClick={() => toggleOMonth(i)}
                style={{ width: '100%', height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }}
              />
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>주요 측정 지표(KR)</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gap: 8, border: '1px dashed #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div className="resp-2">
                  <input value={r.title} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, title: e.target.value } : rr))} placeholder={`KR ${i+1} 제목`} style={input} />
                  <input value={r.metric} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, metric: e.target.value } : rr))} placeholder="KR 내용/측정 기준" style={input} />
                </div>
                <div className="resp-3">
                  <input type="number" step="any" value={r.target} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, target: e.target.value } : rr))} placeholder="측정 수치" style={input} />
                  <input value={r.unit} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, unit: e.target.value } : rr))} placeholder="단위" style={input} />
                  <select value={r.direction} onChange={(e) => setRows(prev => prev.map((rr, idx) => idx === i ? { ...rr, direction: e.target.value as any } : rr))} style={{ ...input, appearance: 'auto' as any }}>
                    <option value="AT_LEAST">이상 (≥ 목표가 좋음)</option>
                    <option value="AT_MOST">이하 (≤ 목표가 좋음)</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) repeat(12, minmax(18px, 1fr))', gap: 6, alignItems: 'center' }}>
                  <div />
                  {months2026.map((_, m) => (
                    <div key={`ml-${i}-${m}`} style={{ textAlign: 'center', fontSize: 12, color: '#64748b' }}>{m + 1}</div>
                  ))}
                  <div style={{ gridColumn: '1 / span 1' }} />
                  {r.months.map((on, m) => (
                    <div
                      key={`mm-${i}-${m}`}
                      onClick={() => toggleRMonth(i, m)}
                      style={{ width: '100%', height: 20, border: '1px solid #e5e7eb', borderRadius: 4, background: on ? '#0F3D73' : '#f8fafc', cursor: 'pointer' }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => removeRow(i)}>행 제거</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={addRow}>KR 행 추가</button>
            <button className="btn btn-primary" onClick={save} disabled={!userId || loading || saving}>{saving ? '저장중…' : '저장'}</button>
          </div>
        </div>
      </section>

      {success && (
        <div style={{ color: '#16a34a', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{success}</span>
          <Link to="/okr/tree" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>OKR 조회</Link>
          <Link to="/me/goals" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>내 목표</Link>
        </div>
      )}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>내 OKR 목록</h3>
        <div style={card}>
          <div style={{ display: 'grid', gap: 10 }}>
            {myObjectives.map((o) => (
              <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>목표</span>
                  <b>{o.title}</b>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{o.pillar || '-'}</span>
                </div>
                {Array.isArray(o.keyResults) && o.keyResults.length > 0 && (
                  <ul style={{ marginLeft: 18 }}>
                    {o.keyResults.map((kr: any) => (
                      <li key={kr.id}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 600 }}>{o.title} / KR: {kr.title}</div>
                          <div style={{ color: '#334155' }}>({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {myObjectives.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>등록된 OKR이 없습니다.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};
