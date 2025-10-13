import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { WorklogNew } from './pages/WorklogNew';
import { WorklogDetail } from './pages/WorklogDetail';
import { Inbox } from './pages/Inbox';

export function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', borderBottom: '1px solid #eee' }}>
        <Link to="/">Home</Link>
        <Link to="/worklogs/new">업무일지 작성</Link>
        <Link to="/inbox">인박스</Link>
      </div>
      <div style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/worklogs/new" element={<WorklogNew />} />
          <Route path="/worklogs/:id" element={<WorklogDetail />} />
          <Route path="/inbox" element={<Inbox />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
