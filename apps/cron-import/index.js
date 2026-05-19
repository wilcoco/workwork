/**
 * SharePoint 생산 데이터 자동 가져오기
 * Railway Cron으로 매일 7:10에 실행
 */

const API_URL = process.env.API_URL || 'https://worklog.icams.co.kr';
const USER_ID = process.env.USER_ID || 'cmkkvpopa0001sbpqnk5cbpiu';

const IMPORTS = [
  { name: '조립', titleFilter: '전날 조립 생산 데이터입니다' },
  { name: '사출', titleFilter: '전날 사출 생산 데이터입니다' },
  { name: '도장', titleFilter: '전날 도장 생산 데이터입니다' },
];

async function importWorklog(titleFilter) {
  const response = await fetch(`${API_URL}/api/sharepoint-sync/import-worklog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER_ID, titleFilter }),
  });
  return response.json();
}

async function main() {
  console.log(`[${new Date().toISOString()}] 생산 데이터 가져오기 시작`);

  for (const { name, titleFilter } of IMPORTS) {
    try {
      console.log(`[${name}] 가져오는 중...`);
      const result = await importWorklog(titleFilter);
      if (result.success) {
        console.log(`[${name}] 성공: worklogId=${result.worklogId}, 제목="${result.title}"`);
      } else {
        console.log(`[${name}] 실패: ${result.message || JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(`[${name}] 에러:`, error.message);
    }
  }

  console.log(`[${new Date().toISOString()}] 완료`);
  process.exit(0);
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
