import React, { useEffect, useState } from 'react';

export type ComboMember = { id: string; name: string; orgName?: string };

/**
 * 이름 검색 + 드롭다운(datalist)을 겸한 구성원 필터.
 * - 타이핑하면 자동완성 목록에서 좁혀지고, 목록에서 바로 선택도 가능.
 * - 선택 결과는 사용자 id 로 onChange 된다(빈 문자열이면 전체).
 */
export function MemberComboFilter({
  id,
  users,
  value,
  onChange,
  placeholder,
  style,
}: {
  id: string; // datalist id (페이지 내 유일해야 함)
  users: ComboMember[];
  value: string; // 선택된 userId ('' = 전체)
  onChange: (userId: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const label = (u: ComboMember) => `${u.name}${u.orgName ? ` (${u.orgName})` : ''}`;
  const [text, setText] = useState('');

  // 외부에서 value 가 바뀌면 입력 텍스트도 동기화
  useEffect(() => {
    const sel = users.find((u) => u.id === value);
    setText(sel ? label(sel) : '');
  }, [value, users]);

  function commit(raw: string) {
    const t = raw.trim();
    if (!t) { onChange(''); return; }
    // 라벨 완전일치 → 이름 완전일치 → 부분일치 순
    let u = users.find((x) => label(x) === t) || users.find((x) => x.name === t);
    if (!u) {
      const lower = t.toLowerCase();
      u = users.find((x) => label(x).toLowerCase().includes(lower) || x.name.toLowerCase().includes(lower));
    }
    onChange(u ? u.id : '');
  }

  return (
    <>
      <input
        list={id}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
        style={style}
      />
      <datalist id={id}>
        {users.map((u) => (<option key={u.id} value={label(u)} />))}
      </datalist>
    </>
  );
}
