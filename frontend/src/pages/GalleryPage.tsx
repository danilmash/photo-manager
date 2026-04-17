import pageLayout from '../styles/page-layout.module.css';

export default function GalleryPage() {
  return (
    <div className={pageLayout.page}>
      <section className={pageLayout['page-intro']} aria-labelledby="gallery-title">
        <h1 id="gallery-title" className={pageLayout.title}>
          Галерея
        </h1>
      </section>
    </div>
  );
}
