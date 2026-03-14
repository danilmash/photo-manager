import { useThemeStore } from './stores/useThemeStore';
import styles from './App.module.css';

function App() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h3>Photo Manager</h3>
        <button className={styles.themeToggle} onClick={toggleTheme}>
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </header>

      <main className={styles.main}>
        <section className={styles.palette}>
          <h4>Background</h4>
          <div className={styles.swatchRow}>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-bg-primary)' }}>
              <span>primary</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <span>secondary</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
              <span>tertiary</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-bg-elevated)' }}>
              <span>elevated</span>
            </div>
          </div>

          <h4>Text</h4>
          <div className={styles.textSamples}>
            <p style={{ color: 'var(--color-text-primary)' }}>Primary text — основной текст интерфейса</p>
            <p style={{ color: 'var(--color-text-secondary)' }}>Secondary text — второстепенная информация</p>
            <p style={{ color: 'var(--color-text-tertiary)' }}>Tertiary text — подсказки и метаданные</p>
            <p style={{ color: 'var(--color-text-disabled)' }}>Disabled text — неактивные элементы</p>
          </div>

          <h4>Accent & Status</h4>
          <div className={styles.swatchRow}>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-accent)' }}>
              <span className={styles.inverseText}>accent</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-danger)' }}>
              <span className={styles.inverseText}>danger</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-warning)' }}>
              <span className={styles.inverseText}>warning</span>
            </div>
            <div className={styles.swatch} style={{ backgroundColor: 'var(--color-success)' }}>
              <span className={styles.inverseText}>success</span>
            </div>
          </div>

          <h4>Typography Scale</h4>
          <div className={styles.typeSamples}>
            <p style={{ fontSize: 'var(--font-size-xs)' }}>xs — 11px</p>
            <p style={{ fontSize: 'var(--font-size-sm)' }}>sm — 12px</p>
            <p style={{ fontSize: 'var(--font-size-base)' }}>base — 13px</p>
            <p style={{ fontSize: 'var(--font-size-md)' }}>md — 14px</p>
            <p style={{ fontSize: 'var(--font-size-lg)' }}>lg — 16px</p>
            <p style={{ fontSize: 'var(--font-size-xl)' }}>xl — 20px</p>
            <p style={{ fontSize: 'var(--font-size-2xl)' }}>2xl — 24px</p>
            <p style={{ fontSize: 'var(--font-size-3xl)' }}>3xl — 32px</p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
