import type { UserPublic } from '../../../../api/users';
import Button from '../../../ui/Button';
import styles from './UserList.module.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  editor: 'Редактор',
};

interface UserListProps {
  users: UserPublic[];
  onEdit: (user: UserPublic) => void;
  onResetPassword: (user: UserPublic) => void;
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`${styles.badge} ${role === 'admin' ? styles['badge-admin'] : styles['badge-editor']}`}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`${styles.badge} ${isActive ? styles['badge-active'] : styles['badge-inactive']}`}>
      {isActive ? 'Активен' : 'Неактивен'}
    </span>
  );
}

function UserActions({
  user,
  onEdit,
  onResetPassword,
}: {
  user: UserPublic;
  onEdit: (user: UserPublic) => void;
  onResetPassword: (user: UserPublic) => void;
}) {
  return (
    <div className={styles.actions}>
      <Button color="secondary" variant="outline" size="sm" onClick={() => onEdit(user)}>
        Изменить
      </Button>
      <Button color="muted" variant="ghost" size="sm" onClick={() => onResetPassword(user)}>
        Пароль
      </Button>
    </div>
  );
}

export default function UserList({ users, onEdit, onResetPassword }: UserListProps) {
  if (users.length === 0) {
    return <p className={styles.empty}>Пользователи не найдены</p>;
  }

  return (
    <div className={styles.list}>
      <div className={styles['table-wrap']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Email</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className={styles['name-cell']}>{user.display_name}</td>
                <td className={styles['email-cell']}>{user.email}</td>
                <td><RoleBadge role={user.role} /></td>
                <td><StatusBadge isActive={user.is_active} /></td>
                <td>
                  <UserActions user={user} onEdit={onEdit} onResetPassword={onResetPassword} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        {users.map((user) => (
          <article key={user.id} className={styles.card}>
            <div className={styles['card-header']}>
              <div>
                <div className={styles['card-name']}>{user.display_name}</div>
                <div className={styles['card-email']}>{user.email}</div>
              </div>
            </div>
            <div className={styles['card-meta']}>
              <RoleBadge role={user.role} />
              <StatusBadge isActive={user.is_active} />
            </div>
            <UserActions user={user} onEdit={onEdit} onResetPassword={onResetPassword} />
          </article>
        ))}
      </div>
    </div>
  );
}
