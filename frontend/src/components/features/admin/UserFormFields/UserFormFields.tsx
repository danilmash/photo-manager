import type { UserRole } from '../../../../api/users';
import formStyles from '../userForm.module.css';

interface UserFormFieldsProps {
  idPrefix?: string;
  email?: string;
  onEmailChange?: (value: string) => void;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  password?: string;
  onPasswordChange?: (value: string) => void;
  role?: UserRole;
  onRoleChange?: (value: UserRole) => void;
  isActive?: boolean;
  onIsActiveChange?: (value: boolean) => void;
  showEmail?: boolean;
  showPassword?: boolean;
  showRole?: boolean;
  showIsActive?: boolean;
  emailReadOnly?: boolean;
}

export default function UserFormFields({
  idPrefix = 'user-form',
  email = '',
  onEmailChange,
  displayName,
  onDisplayNameChange,
  password = '',
  onPasswordChange,
  role = 'editor',
  onRoleChange,
  isActive = true,
  onIsActiveChange,
  showEmail = false,
  showPassword = false,
  showRole = false,
  showIsActive = false,
  emailReadOnly = false,
}: UserFormFieldsProps) {
  const emailId = `${idPrefix}-email`;
  const displayNameId = `${idPrefix}-display-name`;
  const passwordId = `${idPrefix}-password`;
  const roleId = `${idPrefix}-role`;
  const isActiveId = `${idPrefix}-is-active`;

  return (
    <div className={formStyles.form}>
      {showEmail && (
        <label className={formStyles.label} htmlFor={emailId}>
          Email
          <input
            id={emailId}
            name="email"
            className={formStyles.input}
            type="email"
            value={email}
            readOnly={emailReadOnly}
            onChange={(e) => onEmailChange?.(e.target.value)}
            required={!emailReadOnly}
            autoComplete="email"
          />
        </label>
      )}

      <label className={formStyles.label} htmlFor={displayNameId}>
        Имя
        <input
          id={displayNameId}
          name="display_name"
          className={formStyles.input}
          type="text"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          required
          maxLength={256}
          autoComplete="name"
        />
      </label>

      {showPassword && onPasswordChange && (
        <label className={formStyles.label} htmlFor={passwordId}>
          Пароль
          <input
            id={passwordId}
            name="password"
            className={formStyles.input}
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
      )}

      {showRole && onRoleChange && (
        <label className={formStyles.label} htmlFor={roleId}>
          Роль
          <select
            id={roleId}
            name="role"
            className={formStyles.select}
            value={role}
            onChange={(e) => onRoleChange(e.target.value as UserRole)}
          >
            <option value="editor">Редактор</option>
            <option value="admin">Администратор</option>
          </select>
        </label>
      )}

      {showIsActive && onIsActiveChange && (
        <label className={formStyles['checkbox-row']} htmlFor={isActiveId}>
          <input
            id={isActiveId}
            name="is_active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => onIsActiveChange(e.target.checked)}
          />
          Активен
        </label>
      )}
    </div>
  );
}
