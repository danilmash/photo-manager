import { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Header from '../Header';
import styles from './Layout.module.css';
import { useAuthStore } from '../../../stores/useAuthStore';

export default function Layout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return <div className={styles.loader}>Загрузка...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={styles.layout}>
      <Header />
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
