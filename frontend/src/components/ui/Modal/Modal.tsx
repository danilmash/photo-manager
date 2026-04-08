import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    variant?: 'default' | 'fullscreen';
    dark: boolean;
}

export default function Modal({ isOpen, onClose, children, variant = 'default', dark = false }: ModalProps) {
    const panelClass = variant === 'fullscreen' ? styles['panel-fullscreen'] : styles.panel;
    
    useBodyScrollLock(isOpen);

    useEffect(() => {
        if (!isOpen) return;

        const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', onKey);

        return () => {
        document.removeEventListener('keydown', onKey);
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