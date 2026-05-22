import { type FormEvent, useEffect, useState } from 'react';
import pageLayout from '../../styles/page-layout.module.css';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../stores/useAuthStore';
import styles from './SettingsPage.module.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  editor: 'Редактор',
};

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [displayName, setDisplayName] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
    }
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const body: {
        display_name?: string;
        current_password?: string;
        new_password?: string;
      } = {};

      if (displayName.trim() !== user.display_name) {
        body.display_name = displayName.trim();
      }

      if (changePassword) {
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }

      if (!body.display_name && !body.new_password) {
        setError('Нет изменений для сохранения');
        return;
      }

      await updateProfile(body);
      setSuccess('Профиль обновлён');
      setChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className={pageLayout['page-narrow']}>
      <section className={pageLayout['page-intro-narrow']} aria-labelledby="settings-title">
        <h1 id="settings-title" className={pageLayout.title}>
          Настройки
        </h1>
        <p className={pageLayout.subtitle}>Профиль и безопасность</p>
      </section>

      <div className={styles.card}>
        <div className={styles['meta-row']}>
          <span className={styles.badge}>{user.email}</span>
          <span
            className={`${styles.badge} ${user.role === 'admin' ? styles['badge-admin'] : ''}`}
          >
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="settings-display-name">
            Отображаемое имя
            <input
              id="settings-display-name"
              name="display_name"
              className={styles.input}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={256}
              autoComplete="name"
            />
          </label>

          <div className={styles['password-section']}>
            {!changePassword ? (
              <button
                type="button"
                className={styles['password-toggle']}
                onClick={() => setChangePassword(true)}
              >
                Сменить пароль
              </button>
            ) : (
              <>
                <h2 className={styles['section-title']}>Смена пароля</h2>
                <label className={styles.label} htmlFor="settings-current-password">
                  Текущий пароль
                  <input
                    id="settings-current-password"
                    name="current_password"
                    className={styles.input}
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required={changePassword}
                    autoComplete="current-password"
                  />
                </label>
                <label className={styles.label} htmlFor="settings-new-password">
                  Новый пароль
                  <input
                    id="settings-new-password"
                    name="new_password"
                    className={styles.input}
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required={changePassword}
                    minLength={8}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="button"
                  className={styles['password-toggle']}
                  onClick={() => {
                    setChangePassword(false);
                    setCurrentPassword('');
                    setNewPassword('');
                  }}
                >
                  Отменить смену пароля
                </button>
              </>
            )}
          </div>

          {error && <p className={pageLayout.alert}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}

          <div className={styles.actions}>
            <Button color="primary" size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
