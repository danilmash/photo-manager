import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import { useState } from "react";
export default function GalleryPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div>
      <h1>Галерея</h1>
      <Button color="primary" onClick={() => setIsModalOpen(true)}>
        Открыть модальное окно
      </Button>
      <Modal variant="fullscreen" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <h2>Модальное окно</h2>
        <p>Это содержимое модального окна.</p>
      </Modal>
    </div>
  );
}
