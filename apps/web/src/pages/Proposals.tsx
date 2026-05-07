import { CamsBrowser } from '../components/CamsBrowser';

export function Proposals() {
  return (
    <CamsBrowser
      config={{
        apiPath: '/api/proposals',
        pageTitle: '품의서',
        docHeading: '품 의 서',
        docNoun: '품의서',
        listLabel: '내 품의서',
        // Proposal pages use 품의 vocabulary; the same field codes mean
        // 품의-specific things here.
        labelOverrides: {
          slpno: '품의번호',
          no: '품의번호',
          amount: '소요금액',
          amt: '소요금액',
          date: '기안일자',
          sname: '기안자',
        },
      }}
    />
  );
}
