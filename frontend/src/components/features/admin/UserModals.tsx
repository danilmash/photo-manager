import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import UserFormFields from './UserFormFields';
import type { UserPublic, UserRole } from '../../../api/users';
import { createUser, resetUserPassword, updateUser } from '../../../api/users';
import formStyles from './userForm.module.css';

function extractError(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Произошла ошибка';
}

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateUserModal({ isOpen, onClose, onSuccess }: CreateUserModalProps) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('editor');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setDisplayName('');
    setPassword('');
    setRole('editor');
    setError('');
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await createUser({ email, display_name: displayName, password, role });
      onSuccess();
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} dark={false}>
      <form className={formStyles['modal-body']} onSubmit={handleSubmit}>
        <h2 className={formStyles['modal-title']}>Новый пользователь</h2>
        {error && <p className={formStyles.error}>{error}</p>}
        <UserFormFields
          idPrefix="create-user"
          showEmail
          email={email}
          onEmailChange={setEmail}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          showPassword
          password={password}
          onPasswordChange={setPassword}
          showRole
          role={role}
          onRoleChange={setRole}
        />
        <div className={formStyles.actions}>
          <Button color="secondary" variant="outline" size="sm" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface EditUserModalProps {
  isOpen: boolean;
  user: UserPublic | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditUserModal({ isOpen, user, onClose, onSuccess }: EditUserModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('editor');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setDisplayName(user.display_name);
    setRole(user.role);
    setIsActive(user.is_active);
    setError('');
  }, [isOpen, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);
    try {
      await updateUser(user.id, {
        display_name: displayName,
        role,
        is_active: isActive,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} dark={false}>
      <form className={formStyles['modal-body']} onSubmit={handleSubmit}>
        <h2 className={formStyles['modal-title']}>Редактировать пользователя</h2>
        <p className={formStyles.label}>{user.email}</p>
        {error && <p className={formStyles.error}>{error}</p>}
        <UserFormFields
          idPrefix="edit-user"
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          showRole
          role={role}
          onRoleChange={setRole}
          showIsActive
          isActive={isActive}
          onIsActiveChange={setIsActive}
        />
        <div className={formStyles.actions}>
          <Button color="secondary" variant="outline" size="sm" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface ResetPasswordModalProps {
  isOpen: boolean;
  user: UserPublic | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetPasswordModal({ isOpen, user, onClose, onSuccess }: ResetPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setError('');
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);
    try {
      await resetUserPassword(user.id, password);
      onSuccess();
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} dark={false}>
      <form className={formStyles['modal-body']} onSubmit={handleSubmit}>
        <h2 className={formStyles['modal-title']}>Сброс пароля</h2>
        <p className={formStyles.label}>{user.display_name} · {user.email}</p>
        {error && <p className={formStyles.error}>{error}</p>}
        <label className={formStyles.label} htmlFor="reset-user-password">
          Новый пароль
          <input
            id="reset-user-password"
            name="new_password"
            className={formStyles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <div className={formStyles.actions}>
          <Button color="secondary" variant="outline" size="sm" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button color="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Сохранение...' : 'Сбросить пароль'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
