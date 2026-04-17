import pageLayout from '../styles/page-layout.module.css';

export default function AlbumsPage() {
  return (
    <div className={pageLayout.page}>
      <section className={pageLayout['page-intro']} aria-labelledby="albums-title">
        <h1 id="albums-title" className={pageLayout.title}>
          Альбомы
        </h1>
      </section>
    </div>
  );
}
