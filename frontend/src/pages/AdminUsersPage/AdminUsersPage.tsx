import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, SlidersHorizontal } from 'lucide-react';
import pageLayout from '../../styles/page-layout.module.css';
import Button from '../../components/ui/Button';
import Drawer from '../../components/ui/Drawer';
import UserList from '../../components/features/admin/UserList';
import {
  CreateUserModal,
  EditUserModal,
  ResetPasswordModal,
} from '../../components/features/admin/UserModals';
import { listUsers } from '../../api/users';
import type { UserPublic, UserRole } from '../../api/users';
import { useAuthStore } from '../../stores/useAuthStore';
import styles from './AdminUsersPage.module.css';

const PAGE_SIZE = 20;
const DESKTOP_MEDIA_QUERY = '(min-width: 769px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

function countActiveFilters(
  search: string,
  roleFilter: UserRole | '',
  activeFilter: 'all' | 'active' | 'inactive',
): number {
  let count = 0;
  if (search.trim()) count += 1;
  if (roleFilter) count += 1;
  if (activeFilter !== 'all') count += 1;
  return count;
}

interface UserFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  roleFilter: UserRole | '';
  onRoleFilterChange: (value: UserRole | '') => void;
  activeFilter: 'all' | 'active' | 'inactive';
  onActiveFilterChange: (value: 'all' | 'active' | 'inactive') => void;
}

function UserFilters({
  search,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  activeFilter,
  onActiveFilterChange,
}: UserFiltersProps) {
  return (
    <div className={styles.filters}>
      <div className={styles['filter-field']}>
        <label className={styles['filter-label']} htmlFor="users-filter-search">
          Поиск
        </label>
        <input
          id="users-filter-search"
          name="q"
          className={styles['filter-input']}
          type="search"
          placeholder="Email или имя"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className={styles['filter-field']}>
        <label className={styles['filter-label']} htmlFor="users-filter-role">
          Роль
        </label>
        <select
          id="users-filter-role"
          name="role"
          className={styles['filter-select']}
          value={roleFilter}
          onChange={(e) => onRoleFilterChange(e.target.value as UserRole | '')}
        >
          <option value="">Все</option>
          <option value="admin">Администратор</option>
          <option value="editor">Редактор</option>
        </select>
      </div>
      <div className={styles['filter-field']}>
        <label className={styles['filter-label']} htmlFor="users-filter-status">
          Статус
        </label>
        <select
          id="users-filter-status"
          name="is_active"
          className={styles['filter-select']}
          value={activeFilter}
          onChange={(e) =>
            onActiveFilterChange(e.target.value as 'all' | 'active' | 'inactive')
          }
        >
          <option value="all">Все</option>
          <option value="active">Активные</option>
          <option value="inactive">Неактивные</option>
        </select>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isDesktop = useIsDesktop();

  const [users, setUsers] = useState<UserPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserPublic | null>(null);
  const [resetUser, setResetUser] = useState<UserPublic | null>(null);

  const activeFiltersCount = countActiveFilters(search, roleFilter, activeFilter);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, roleFilter, activeFilter]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listUsers({
        limit: PAGE_SIZE,
        offset,
        q: debouncedSearch || undefined,
        role: roleFilter || undefined,
        is_active:
          activeFilter === 'all' ? undefined : activeFilter === 'active',
      });
      setUsers(data.items);
      setTotal(data.total);
    } catch {
      setError('Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  }, [offset, debouncedSearch, roleFilter, activeFilter]);

  useEffect(() => {
    if (user?.role === 'admin') {
      void fetchUsers();
    }
  }, [user?.role, fetchUsers]);

  const handleSuccess = (message: string) => {
    setSuccess(message);
    void fetchUsers();
    window.setTimeout(() => setSuccess(''), 3000);
  };

  const resetFilters = () => {
    setSearch('');
    setRoleFilter('');
    setActiveFilter('all');
  };

  const filterProps: UserFiltersProps = {
    search,
    onSearchChange: setSearch,
    roleFilter,
    onRoleFilterChange: setRoleFilter,
    activeFilter,
    onActiveFilterChange: setActiveFilter,
  };

  if (isLoading) {
    return <div className={styles.loading}>Загрузка...</div>;
  }

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className={pageLayout.page}>
      <section className={pageLayout['page-intro']} aria-labelledby="admin-users-title">
        <div className={pageLayout['page-intro-row']}>
          <div>
            <h1 id="admin-users-title" className={pageLayout.title}>
              Пользователи
            </h1>
            <p className={pageLayout.subtitle}>
              Управление учётными записями редакторами и администраторами
            </p>
          </div>
          <Button
            color="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setCreateOpen(true)}
          >
            Добавить
          </Button>
        </div>
      </section>

      <section className={pageLayout.section}>
        <div className={styles['filters-desktop']}>
          <UserFilters {...filterProps} />
        </div>

        <div className={styles['filters-mobile']}>
          <div className={styles['filters-mobile-bar']}>
            <span className={styles['filters-mobile-summary']}>
              {activeFiltersCount > 0
                ? `Фильтры: ${activeFiltersCount}`
                : 'Без фильтров'}
            </span>
            <Button
              color="secondary"
              variant="outline"
              size="sm"
              icon={<SlidersHorizontal size={16} />}
              onClick={() => setFiltersOpen(true)}
            >
              Фильтры
            </Button>
          </div>
        </div>

        {error && <p className={pageLayout.alert}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <div className={styles['list-section']}>
          {loading ? (
            <p className={styles.loading}>Загрузка...</p>
          ) : (
            <>
              <UserList
                users={users}
                onEdit={setEditUser}
                onResetPassword={setResetUser}
              />
              <div className={styles.pagination}>
                <span className={styles['pagination-info']}>
                  {total === 0
                    ? '0 пользователей'
                    : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} из ${total}`}
                </span>
                <div className={styles['pagination-actions']}>
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={!canPrev}
                    onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  >
                    Назад
                  </Button>
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={!canNext}
                    onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  >
                    Вперёд
                  </Button>
                </div>
                <span className={styles['pagination-info']}>
                  Страница {page} из {totalPages}
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {!isDesktop && (
        <Drawer
          title="Фильтры"
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          side="right"
          behavior="overlap"
        >
          <UserFilters {...filterProps} />
          <div className={styles['filters-drawer-actions']}>
            {activeFiltersCount > 0 && (
              <Button color="muted" variant="outline" size="sm" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            )}
            <Button color="primary" size="sm" onClick={() => setFiltersOpen(false)}>
              Готово
            </Button>
          </div>
        </Drawer>
      )}

      <CreateUserModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => handleSuccess('Пользователь создан')}
      />
      <EditUserModal
        isOpen={editUser !== null}
        user={editUser}
        onClose={() => setEditUser(null)}
        onSuccess={() => handleSuccess('Изменения сохранены')}
      />
      <ResetPasswordModal
        isOpen={resetUser !== null}
        user={resetUser}
        onClose={() => setResetUser(null)}
        onSuccess={() => handleSuccess('Пароль обновлён')}
      />
    </div>
  );
}
