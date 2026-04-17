import pageLayout from '../styles/page-layout.module.css';

export default function SettingsPage() {
  return (
    <div className={pageLayout.page}>
      <section className={pageLayout['page-intro']} aria-labelledby="settings-title">
        <h1 id="settings-title" className={pageLayout.title}>
          Настройки
        </h1>
      </section>
    </div>
  );
}
