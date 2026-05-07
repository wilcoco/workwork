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
      }}
    />
  );
}
