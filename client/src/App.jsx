// App routes — owner: Musa. Every page is pre-registered; owners only edit their page files.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuth } from './context/AuthContext';
import { useCan } from './hooks/useCan';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Signup from './pages/Signup';

const P = (loader) => lazy(loader);
const Dashboard = P(() => import('./pages/Dashboard'));
const Leads = P(() => import('./pages/Leads'));
const LeadDetail = P(() => import('./pages/LeadDetail'));
const Recovery = P(() => import('./pages/Recovery'));
const Inbox = P(() => import('./pages/Inbox'));
const Contacts = P(() => import('./pages/Contacts'));
const ContactDetail = P(() => import('./pages/ContactDetail'));
const Companies = P(() => import('./pages/Companies'));
const Opportunities = P(() => import('./pages/Opportunities'));
const OpportunityDetail = P(() => import('./pages/OpportunityDetail'));
const PipelineBoard = P(() => import('./pages/PipelineBoard'));
const Payments = P(() => import('./pages/Payments'));
const Audit = P(() => import('./pages/Audit'));
const Profile = P(() => import('./pages/Profile'));
const PublicForm = P(() => import('./pages/PublicForm'));
const PayPage = P(() => import('./pages/PayPage'));
const Users = P(() => import('./pages/settings/Users'));
const Roles = P(() => import('./pages/settings/Roles'));
const Pipelines = P(() => import('./pages/settings/Pipelines'));
const CustomFields = P(() => import('./pages/settings/CustomFields'));
const AssignmentRules = P(() => import('./pages/settings/AssignmentRules'));
const Integrations = P(() => import('./pages/settings/Integrations'));

const Loading = () => <div className="flex min-h-[40vh] items-center justify-center"><Spinner size="lg" /></div>;

function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

/** Hides a page from users without the permission (server still enforces it — F1.5). */
function Gate({ perm, children }) {
  const can = useCan();
  if (perm && !can(perm)) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <p className="font-semibold">You don&apos;t have access to this page</p>
        <p className="mt-1 text-sm">It needs the “{perm}” permission. Ask your workspace Owner or Admin.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="top-right" closeButton />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/f/:slug" element={<PublicForm />} />
          <Route path="/pay/:token" element={<PayPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/leads/:id" element={<LeadDetail />} />
              <Route path="/recovery" element={<Gate perm="leads.reassign"><Recovery /></Gate>} />
              <Route path="/inbox" element={<Gate perm="crm.view"><Inbox /></Gate>} />
              <Route path="/inbox/:conversationId" element={<Gate perm="crm.view"><Inbox /></Gate>} />
              <Route path="/contacts" element={<Gate perm="crm.view"><Contacts /></Gate>} />
              <Route path="/contacts/:id" element={<Gate perm="crm.view"><ContactDetail /></Gate>} />
              <Route path="/companies" element={<Gate perm="crm.view"><Companies /></Gate>} />
              <Route path="/opportunities" element={<Gate perm="crm.view"><Opportunities /></Gate>} />
              <Route path="/opportunities/:id" element={<Gate perm="crm.view"><OpportunityDetail /></Gate>} />
              <Route path="/pipeline" element={<Gate perm="crm.view"><PipelineBoard /></Gate>} />
              <Route path="/payments" element={<Gate perm="crm.view"><Payments /></Gate>} />
              <Route path="/audit" element={<Gate perm="audit.view"><Audit /></Gate>} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings/users" element={<Gate perm="users.manage"><Users /></Gate>} />
              <Route path="/settings/roles" element={<Gate perm="users.manage"><Roles /></Gate>} />
              <Route path="/settings/pipelines" element={<Gate perm="pipeline.manage"><Pipelines /></Gate>} />
              <Route path="/settings/custom-fields" element={<Gate perm="pipeline.manage"><CustomFields /></Gate>} />
              <Route path="/settings/assignment-rules" element={<Gate perm="rules.manage"><AssignmentRules /></Gate>} />
              <Route path="/settings/integrations" element={<Gate perm="integrations.manage"><Integrations /></Gate>} />
              <Route path="*" element={<div className="p-8 text-center text-slate-500">Page not found.</div>} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
