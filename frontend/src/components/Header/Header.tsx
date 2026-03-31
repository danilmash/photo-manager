import { NavLink } from 'react-router-dom';
import { Home, Images, FolderOpen, Settings, Sun, Moon, Upload } from 'lucide-react';
import { useThemeStore } from '../../stores/useThemeStore';
import styles from './Header.module.css';

const navItems = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/gallery', label: 'Галерея', icon: Images },
  { to: '/import', label: 'Импорт', icon: Upload },
  { to: '/albums', label: 'Альбомы', icon: FolderOpen },
  { to: '/settings', label: 'Настройки', icon: Settings },
] as const;

export default function Header() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <header className={styles.header}>
      <div className={styles.topBar}>
        <span className={styles.logo}>Photo Manager</span>

        <nav className={styles.desktopNav}>
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${styles.desktopLink} ${isActive ? styles.active : ''}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label="Переключить тему"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <nav className={styles.bottomNav}>
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles.bottomLink} ${isActive ? styles.active : ''}`
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
