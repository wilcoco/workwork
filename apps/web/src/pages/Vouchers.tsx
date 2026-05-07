import { CamsBrowser } from '../components/CamsBrowser';

export function Vouchers() {
  return (
    <CamsBrowser
      config={{
        apiPath: '/api/vouchers',
        pageTitle: '전표',
        docHeading: '전 표',
        docNoun: '전표',
        listLabel: '내 전표',
        format: 'voucher',
        // Voucher pages use the same field codes as proposals but with
        // accounting-specific meanings — override the default labels.
        labelOverrides: {
          slpno: '전표번호',
          no: '전표번호',
          sname: '품의자',
          user: '품의자',
          name: '품의자',
          date: '기표일자',
          amount: '금액',
          amt: '금액',
        },
      }}
    />
  );
}
