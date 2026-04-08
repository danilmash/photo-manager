import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    variant?: 'default' | 'fullscreen';
    dark: boolean;
}

export default function Modal({ isOpen, onClose, children, variant = 'default', dark = false }: ModalProps) {
    const panelClass = variant === 'fullscreen' ? styles['panel-fullscreen'] : styles.panel;
    
    useEffect(() => {
        if (!isOpen) return;

        const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', onKey);

        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prev;
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div className={`${styles.backdrop} ${dark ? styles.dark : ""}`} onClick={onClose}>
        <div
            className={panelClass}
            onClick={(e) => e.stopPropagation()}
        >
            {children}
        </div>
        </div>,
        document.body
    );
    }