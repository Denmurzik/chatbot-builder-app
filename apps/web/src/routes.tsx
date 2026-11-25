import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGuard } from '@/app/AuthGuard';
import { EditorPage } from '@/editor/EditorPage';
import { BotsPage } from '@/pages/BotsPage';
import { LoginPage } from '@/pages/LoginPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { RegisterPage } from '@/pages/RegisterPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AuthGuard />}>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<EditorPage />} />
        <Route path="/projects/:id/bots" element={<BotsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
