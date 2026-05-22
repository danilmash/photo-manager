import { NavLink } from 'react-router-dom';
import { Home, Settings, Sun, Moon, Upload, Users } from 'lucide-react';
import { useThemeStore } from '../../../stores/useThemeStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import UserMenu from '../UserMenu';
import styles from './Header.module.css';

const baseNavItems = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/import', label: 'Импорт', icon: Upload },
  { to: '/settings', label: 'Настройки', icon: Settings },
] as const;

const adminNavItem = { to: '/admin/users', label: 'Пользователи', icon: Users } as const;

function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();
  return (
    <button
      className={styles['theme-toggle']}
      onClick={toggleTheme}
      aria-label="Переключить тему"
      type="button"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default function Header() {
  const user = useAuthStore((s) => s.user);

  const navItems =
    user?.role === 'admin' ? [...baseNavItems, adminNavItem] : [...baseNavItems];

  return (
    <header className={styles.header} aria-label="Навигация приложения">
      <div className={styles['top-bar']}>
        <span className={styles.logo}>Photo Manager</span>
        <nav className={styles['desktop-nav']}>
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${styles['desktop-link']} ${isActive ? styles.active : ''}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className={styles['top-actions']}>
          <UserMenu />
          <ThemeToggle />
        </div>
      </div>

      <div className={styles['mobile-bar']}>
        <span className={styles.logo}>Photo Manager</span>
        <div className={styles['top-actions']}>
          <UserMenu compact />
          <ThemeToggle />
        </div>
      </div>

      <nav className={styles['bottom-nav']}>
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles['bottom-link']} ${isActive ? styles.active : ''}`
            }
          >
            <Icon size={22} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
