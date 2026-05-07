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
      }}
    />
  );
}
